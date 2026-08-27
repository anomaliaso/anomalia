import { describe, it, expect } from 'vitest';
import { AVATAR_FACE_SPECS } from '$lib/agent-avatars';

/**
 * The gaze in AgentAvatar.svelte adds arc length to a feature's x and y before
 * `decalTransform` wraps it onto the ball — the same knob `spec.yaw` turns. That function
 * clamps at MAX_ANGLE so a feature can never slide past the limb, and hitting the clamp is
 * exactly the ugly frame we do not want: the eyes stop while the pointer keeps going.
 *
 * So the swing has to stay INSIDE the clamp for every face, not merely be caught by it.
 * These numbers mirror the component's constants (and agent-avatars' own private R /
 * MAX_ANGLE) on purpose: this test is the thing that notices when a new face is authored
 * with a bigger yaw and quietly eats the margin.
 */
const R = 20;
const MAX_ANGLE = 1.15;
const GAZE_ARC = 4;
const REST_PITCH = 5.5;

describe('avatar gaze stays inside the projection clamp', () => {
  it('never pushes a feature to MAX_ANGLE, at full swing, on any face', () => {
    for (const [name, spec] of Object.entries(AVATAR_FACE_SPECS)) {
      for (const f of spec.features) {
        // Both mirror signs: the flip negates `f.x + yaw` while the gaze stays in screen space,
        // so the feature that reaches furthest swaps sides. The bound is the same either way,
        // but prove it rather than argue it.
        for (const flip of [1, -1]) {
          // decalTransform clamps the feature's ORIGIN — the shape is then drawn in the tangent
          // plane at that point. Worst case: the feature offset the furthest way, plus yaw, plus
          // the resting downward pitch, plus a pointer in the far corner of a wide screen.
          const x = Math.abs(flip * (f.x + spec.yaw)) + GAZE_ARC;
          const y = Math.abs(f.y + REST_PITCH) + GAZE_ARC;
          const angle = Math.hypot(x, y) / R;
          const where = `${name} feature (mirror ${flip < 0})`;
          expect(angle, `${where} reaches ${angle.toFixed(3)}rad`).toBeLessThan(MAX_ANGLE);
        }
      }
    }
  });

  it('tanh saturation cannot exceed the swing, however far the pointer is', () => {
    for (const d of [0, 100, 260, 1000, 100000]) {
      expect(Math.abs(GAZE_ARC * Math.tanh(d / 260))).toBeLessThanOrEqual(GAZE_ARC);
    }
  });
});

export type ModalState = {
  route: string | null;
  origin: string | null;
};

export enum ModalSurface {
  Desktop = 'desktop',
  FullWidth = 'full-width'
}

export function modalVisible(
  state: ModalState,
  current: string,
  surface: ModalSurface
): boolean {
  return surface === ModalSurface.Desktop && state.route !== null && state.origin === current;
}

export function backHref(origin: string | null, fallback: string): string {
  return origin ?? fallback;
}

export function postPreviewHref(base: string, postId: string): string {
  return `${base}/posts/${postId}/preview`;
}

import type { GuestOnboardingPending } from '$lib/guest-onboarding';

export function guestAssignments(guest: GuestOnboardingPending) {
  return {
    url: guest.url,
    noWebsite: guest.noWebsite,
    brandName: guest.brandName,
    creatorNiche: guest.creatorNiche,
    selectedPlatforms: guest.selectedPlatforms,
    handles: guest.handles
  };
}

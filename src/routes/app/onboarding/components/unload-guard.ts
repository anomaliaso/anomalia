export function guardUnload(getActive: () => boolean) {
  if (typeof window === 'undefined') return;
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!getActive()) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}

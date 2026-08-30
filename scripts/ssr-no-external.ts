export function ssrNoExternalForDeploy(deployTarget: string): string[] {
  return deployTarget === 'node' ? [] : ['simple-icons'];
}

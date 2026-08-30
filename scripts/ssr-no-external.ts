export function ssrNoExternalForDeploy(deployTarget: string): (string | RegExp)[] {
  return deployTarget === 'node' ? [/^@anomalia\//] : ['simple-icons'];
}

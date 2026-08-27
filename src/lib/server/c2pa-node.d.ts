/**
 * Minimal ambient types for `c2pa-node`, which is deliberately NOT installed.
 *
 * The package carries a 38 MB native binary and took the Vercel function past the 250 MB limit to
 * support signing that is off by default (see content-credentials.ts). It is imported dynamically
 * and no-ops when missing — but TypeScript still needs a shape for the specifier, or every check
 * run reports three "cannot find module" errors on code that is working as designed.
 *
 * Only the four exports the signing path touches are declared, loosely: if someone installs the
 * real package to work on signing, this shadows its types rather than fighting them, and the call
 * site is small enough that the loss is not worth a build-time dependency.
 */
declare module 'c2pa-node' {
  export enum SigningAlgorithm {
    ES256 = 'Es256',
    ES384 = 'Es384',
    ES512 = 'Es512',
    PS256 = 'Ps256',
    PS384 = 'Ps384',
    PS512 = 'Ps512',
    Ed25519 = 'Ed25519'
  }

  export type Signer =
    | { type: 'local'; certificate: Buffer; privateKey: Buffer; algorithm?: SigningAlgorithm }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | Record<string, any>;

  export function createTestSigner(): Promise<Signer>;

  export class ManifestBuilder {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(definition: Record<string, any>);
  }

  export type ReadResult = {
    active_manifest?: {
      claim_generator?: string;
      signature_info?: { issuer?: string };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertions?: Array<{ label?: string; data?: any }>;
    };
    validation_status?: Array<{ code?: string }>;
  } | null;

  export function createC2pa(opts?: { signer?: Signer }): {
    sign(input: {
      asset: { buffer: Buffer; mimeType: string };
      manifest: ManifestBuilder;
    }): Promise<{ signedAsset: { buffer: Buffer } }>;
    read(input: { buffer: Buffer; mimeType: string }): Promise<ReadResult>;
  };
}

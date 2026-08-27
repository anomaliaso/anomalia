declare module 'heic-decode' {
	interface HeicDecoded {
		width: number;
		height: number;
		data: Uint8ClampedArray;
	}
	function decode(opts: { buffer: ArrayBuffer | Uint8Array | Buffer }): Promise<HeicDecoded>;
	export default decode;
}

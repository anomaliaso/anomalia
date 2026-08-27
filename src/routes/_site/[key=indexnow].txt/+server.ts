// Same IndexNow key file on custom blog domains: hooks.ts reroutes /<key>.txt on a brand host to
// /_site/<key>.txt, so without this route every custom-domain submission was rejected (the key
// location we send in the ping 404'd). Reuses the root handler — one key, one implementation.
export { GET } from '../../[key=indexnow].txt/+server';

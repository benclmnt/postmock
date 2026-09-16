// Preloaded into the postmark.js suite (`mocha -r`). postmark.js calls the global fetch at request
// time (sdk/postmark.js/src/client/HttpClient.ts:24), so replacing it routes every call to postmock
// without a change to the suite (docs/08 §5.1). Any other host throws: nothing reaches the network.
const target = new URL(process.env.POSTMOCK_API_URL);
const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "api.postmarkapp.com") {
    throw new Error(`postmock fetch shim: refusing a request to ${url.origin}`);
  }
  url.protocol = target.protocol;
  url.host = target.host;
  return realFetch(input instanceof Request ? new Request(url, input) : url, init);
};

// Share only concurrent reads. Settled results/errors are never cached, so a
// later explicit refresh always observes the server again.
export function sharePendingRequest(requests, key, load) {
  if (requests.has(key)) return requests.get(key);
  const clear = () => { if (requests.get(key) === shared) requests.delete(key); };
  const shared = Promise.resolve().then(load).then(
    result => { clear(); return result; },
    failure => { clear(); throw failure; }
  );
  requests.set(key, shared);
  return shared;
}

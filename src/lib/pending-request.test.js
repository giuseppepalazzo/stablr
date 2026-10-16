import {sharePendingRequest} from './pending-request';

test('only in-flight requests coalesce; every later refresh reads fresh data',async()=>{
  const requests=new Map();let resolve;const load=jest.fn(()=>new Promise(done=>{resolve=done;}));
  const first=sharePendingRequest(requests,'user-a',load),second=sharePendingRequest(requests,'user-a',load);
  expect(second).toBe(first);await Promise.resolve();expect(load).toHaveBeenCalledTimes(1);
  resolve('before');expect(await first).toBe('before');expect(requests.size).toBe(0);
  const fresh=jest.fn().mockResolvedValue('after');expect(await sharePendingRequest(requests,'user-a',fresh)).toBe('after');expect(fresh).toHaveBeenCalledTimes(1);
});

test('separate users/queries never share results, errors clear without automatic retries',async()=>{
  const requests=new Map(),load=jest.fn().mockRejectedValue(new Error('offline'));
  await expect(sharePendingRequest(requests,'user-a',load)).rejects.toThrow('offline');expect(requests.size).toBe(0);expect(load).toHaveBeenCalledTimes(1);
  const [a,b]=await Promise.all([sharePendingRequest(requests,'user-a',()=>1),sharePendingRequest(requests,'user-b',()=>2)]);
  expect([a,b]).toEqual([1,2]);expect(requests.size).toBe(0);
});

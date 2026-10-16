// Task 6 service + installed SDK. All HTTP responses are test fixtures only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PostgrestClient} from '@supabase/postgrest-js';
import {createCatalogMetadataService} from '../../src/admin/catalog-metadata-data.js';

for(const [label,status,code] of [['unavailable',503,'PGRST002'],['gateway',520,''],['conflict',409,'PT409']]){
  test(`metadata service sends one history request on ${label}; no SDK retry`,async t=>{
    t.mock.method(console,'error',()=>{});let requests=0;
    const client=new PostgrestClient('https://fixture.invalid/rest/v1',{fetch:async()=>{
      requests++;return new Response(JSON.stringify({code,message:'Fixture error'}),{status,headers:{'Content-Type':'application/json','Retry-After':'0'}});
    }});
    await assert.rejects(()=>createCatalogMetadataService(client,'route').getHistory('fixture-course'));
    assert.equal(requests,1);
  });
}

test('network failure sends one request and leaves retry to the explicit UI action',async t=>{
  t.mock.method(console,'error',()=>{});let requests=0;
  const client=new PostgrestClient('https://fixture.invalid/rest/v1',{fetch:async()=>{
    requests++;throw new TypeError('Fixture network failure');
  }});
  await assert.rejects(()=>createCatalogMetadataService(client,'route').getHistory('fixture-course'));
  assert.equal(requests,1);
});

test('metadata service never caches completed history reads or retries failed recovery reads',async t=>{
  t.mock.method(console,'error',()=>{});let requests=0;
  const client=new PostgrestClient('https://fixture.invalid/rest/v1',{fetch:async url=>{
    requests++;
    const recovery=new URL(url).pathname.endsWith('/admin_catalog_drafts');
    return new Response(JSON.stringify(recovery?{code:'PGRST002',message:'Fixture error'}
      :{kind:'route',target_id:'fixture-course',history:[],has_open_draft:false}),
      {status:recovery?503:200,headers:{'Content-Type':'application/json','Retry-After':'0'}});
  }});
  const service=createCatalogMetadataService(client,'route');
  await service.getHistory('fixture-course');await service.getHistory('fixture-course');assert.equal(requests,2);
  await assert.rejects(()=>service.recoverDraft({draft_id:'fixture-draft',live_entity_id:'fixture-course'}));
  assert.equal(requests,3);
});

// Real installed PostgREST client, fake transport ONLY; no remote requests.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PostgrestClient} from '@supabase/postgrest-js';

for(const [status,code] of [[500,'40001'],[409,'PT409'],[504,'57014']]){
  test(`installed SDK does not retry metadata preview HTTP ${status}/${code}`,async t=>{
    let requests=0;
    t.mock.method(console,'error',()=>{});
    const client=new PostgrestClient('https://fixture.invalid/rest/v1',{
      fetch:async(url,options)=>{
        requests++;
        assert.equal(options.method,'GET');
        const params=new URL(url).searchParams;
        assert.equal(params.get('p_action'),'preview');assert.equal(params.get('p_expected_revision'),'7');
        return new Response(JSON.stringify({code,message:'Fixture conflict'}),{status,headers:{'Content-Type':'application/json'}});
      }
    });
    const result=await client.rpc('admin_catalog_metadata',{
      p_kind:'route',p_target:'fixture-course',p_action:'preview',p_draft_id:'fixture-draft',p_expected_revision:7
    },{get:true});
    assert.equal(result.error.code,code);
    assert.equal(requests,1);
  });
}

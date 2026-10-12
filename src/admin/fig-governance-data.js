export function createFigGovernanceService(client) {
  const invoke = async (name,args) => {
    if(!client)throw new Error('Admin unavailable');
    const {data,error}=await client.rpc(name,args);if(error)throw error;if(!data)throw new Error('Missing governance response');return data;
  };
  return {
    overview: (offset=0,showResolved=false) => invoke('admin_fig_overview',{p_offset:offset,p_show_resolved:showResolved}),
    async check(requestId) {
      if(!client)throw new Error('Admin unavailable');
      const {data,error}=await client.functions.invoke('fig-governance',{body:{operation:'check',request_id:requestId}});
      if(error)throw error;if(!data?.id||!['running','success','failed'].includes(data.status))throw new Error('Invalid check response');return data;
    },
    decide: (id,action,note) => invoke('admin_fig_decide',{p_difference_id:id,p_action:action,p_note:note})
  };
}

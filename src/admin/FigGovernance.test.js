import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FigGovernance from './FigGovernance';
import { createFigGovernanceService } from './fig-governance-data';
const unknown={id:'unknown',kind:'new',needs_identity:true,can_draft:false,origin:'public',created_at:'2026-10-12T10:00:00Z',before:null,after:{name:'FIG osservazione',course:'9 Buche',par:35,ratings:Array(14).fill(null)},curated:null,decision:null};
const linked={id:'linked',kind:'changed',needs_identity:false,can_draft:true,origin:'catalog',created_at:'2026-10-12T10:00:00Z',before:{name:'Prima',city:null},after:{name:'Dopo',city:'Roma'},curated:{name:'Curato',city:null},decision:null};
const data={last_check:{status:'success',started_at:'2026-10-12T10:00:00Z'},baseline:{finished_at:'2026-10-12T10:01:00Z'},total:2,queue:[unknown,linked]};
const service=()=>({overview:jest.fn().mockResolvedValue(data),check:jest.fn().mockResolvedValue({id:'run',status:'success'}),decide:jest.fn().mockResolvedValue({draft_id:'draft',club_id:'club'})});
const previousCrypto=window.crypto;
beforeAll(()=>{Object.defineProperty(window,'crypto',{configurable:true,value:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'}});});
afterAll(()=>{Object.defineProperty(window,'crypto',{configurable:true,value:previousCrypto});});
test('manual server check; unidentified observation cannot be attributed or drafted; confirm and note required',async()=>{
 const s=service();render(<FigGovernance service={s} onBack={jest.fn()}/>);
 expect(screen.getByRole('status')).toHaveTextContent('Caricamento');expect(screen.queryByText('Coda FIG · 0')).not.toBeInTheDocument();
 await screen.findByText('Coda FIG · 2');fireEvent.click(screen.getByRole('button',{name:'Verifica FIG ora'}));await waitFor(()=>expect(s.check).toHaveBeenCalledTimes(1));
 fireEvent.click(screen.getByRole('button',{name:/FIG osservazione/}));const detail=screen.getByRole('dialog');
 expect(within(detail).getByRole('button',{name:'Apri proposta in bozza'})).toBeDisabled();expect(within(detail).queryByText('STABLR curato')).not.toBeInTheDocument();
 expect(within(detail).getByText(/Proposta in bozza non disponibile/)).toHaveClass('stablr-admin-fig-draft-unavailable');
 fireEvent.click(within(detail).getByRole('button',{name:'Ignora modifica'}));expect(s.decide).not.toHaveBeenCalled();
 const dialogs=screen.getAllByRole('dialog');const confirmation=dialogs[1];expect(within(confirmation).getByRole('button',{name:'Conferma decisione'})).toBeDisabled();
 fireEvent.change(within(confirmation).getByLabelText('Nota obbligatoria'),{target:{value:'Osservazione senza identità'}});
 fireEvent.click(within(confirmation).getByRole('button',{name:'Conferma decisione'}));await waitFor(()=>expect(s.decide).toHaveBeenCalledWith('unknown','ignore','Osservazione senza identità'));
});
test('three-way display only on verified link; explicit proposal opens existing Club draft',async()=>{
 const s=service(),onOpenDraft=jest.fn();render(<FigGovernance service={s} onBack={jest.fn()} onOpenDraft={onOpenDraft}/>);
 await screen.findByText('Coda FIG · 2');fireEvent.click(screen.getByRole('button',{name:/Dopo/}));
 expect(screen.getByText('STABLR curato')).toBeInTheDocument();expect(screen.getByText('Curato')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Apri proposta in bozza'}));const dialog=screen.getAllByRole('dialog')[1];
 fireEvent.change(within(dialog).getByLabelText('Nota obbligatoria'),{target:{value:'Decisione manuale'}});fireEvent.click(within(dialog).getByRole('button',{name:'Conferma decisione'}));
 await waitFor(()=>expect(onOpenDraft).toHaveBeenCalledWith('club','draft'));
});
test('no check yet and failure keep a truthful empty/baseline status; retryable loading error',async()=>{
 const s=service();s.overview.mockResolvedValue({last_check:{status:'failed',started_at:'2026-10-12T10:00:00Z',failure_code:'SOURCE_UNAVAILABLE'},baseline:data.baseline,total:0,queue:[]});
 const root=render(<FigGovernance service={s} onBack={jest.fn()}/>);await screen.findByText('Fallito');expect(screen.getByText(/Baseline precedente conservata/)).toBeInTheDocument();root.unmount();
 const failing=service();failing.overview.mockRejectedValue(new Error('PRIVATE ERROR'));const log=jest.spyOn(console,'error').mockImplementation(()=>{});
 render(<FigGovernance service={failing} onBack={jest.fn()}/>);await screen.findByRole('alert');expect(screen.queryByText('Coda FIG · 0')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Riprova lettura'}));await waitFor(()=>expect(failing.overview).toHaveBeenCalledTimes(2));log.mockRestore();
});
test('persistent decisions visible read-only; filters and pagination use actual loaded total',async()=>{
 const s=service();s.overview.mockResolvedValue({...data,total:51,queue:[{...unknown,decision:{action:'ignore',note:'Già esaminata',created_at:'2026-10-12T10:00:00Z'}}]});
 const back=jest.fn();render(<FigGovernance service={s} onBack={back}/>);await screen.findByText('Coda FIG · 51');
 fireEvent.click(screen.getByRole('button',{name:'Tutte le decisioni'}));await waitFor(()=>expect(s.overview).toHaveBeenCalledWith(0,true));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Successive'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Successive'}));await waitFor(()=>expect(s.overview).toHaveBeenCalledWith(50,true));
 fireEvent.click(screen.getByRole('button',{name:/FIG osservazione/}));expect(screen.getByText(/Già esaminata/)).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Ignora modifica'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Chiudi'}));fireEvent.click(screen.getByRole('button',{name:'Avanzata'}));expect(back).toHaveBeenCalledTimes(1);
});
test('service does not expose service credentials or generic writes; errors propagate',async()=>{
 const client={rpc:jest.fn().mockResolvedValue({data:{total:0,queue:[]},error:null}),functions:{invoke:jest.fn().mockResolvedValue({data:{id:'run',status:'success'},error:null})}};
 const s=createFigGovernanceService(client);await s.overview(50,true);await s.check('request');await s.decide('difference','ignore','note');
 expect(client.rpc).toHaveBeenNthCalledWith(1,'admin_fig_overview',{p_offset:50,p_show_resolved:true});expect(client.functions.invoke).toHaveBeenCalledWith('fig-governance',{body:{operation:'check',request_id:'request'}});
 expect(client.rpc).toHaveBeenNthCalledWith(2,'admin_fig_decide',{p_difference_id:'difference',p_action:'ignore',p_note:'note'});
 client.rpc.mockResolvedValue({error:{code:'42501'}});await expect(s.overview()).rejects.toEqual({code:'42501'});
});

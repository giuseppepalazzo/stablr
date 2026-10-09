import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import TeeEvidence from "./TeeEvidence";
import StructureReview from "./StructureReview";
import { createTeeEvidenceService } from "./tee-evidence-data";

const batch = { id: "batch-fixture", source: "fig", extractor_version: "fig-raw-tee-evidence/1.0.0", confirmed_at: "2026-10-09T10:00:00Z", total: 2, inserted: 1, existing: 0, incomplete: 1, excluded: 1 };
const evidence = { id: "evidence-fixture", club_label: "Club fixture", configuration_label: "18 Buche fixture", tee_label: "GIALLO", internal_reference: "table:0/row:3/tee-column:1", par_original: "72", par_normalized: 72, par_state: "esplicito", scope_original: "18 Buche fixture", scope_normalized: 18, scope_state: "esplicito", applicability_original: null, applicability_normalized: null, applicability_state: "assente", external_tee_id: null, external_configuration_id: null, completeness: "incomplete", par_origin: "comune_configurazione", limitations: ["native_tee_id_absent", "applicability_header_spans_unavailable", "par_common_configuration"] };
const detail = { batch: { ...batch, note: "Approvazione esplicita fixture", current_admin: true }, artifact: { source: "fig", source_version: "2026-05-16", acquired_at: "2026-05-16T10:00:00Z", published_at: null, sha256: "a".repeat(64), extractor_version: batch.extractor_version }, offset: 0, items: [
  { observation_id: evidence.internal_reference, evidence, outcome: "inserted", reason: "incomplete_source_evidence" },
  { observation_id: "table:0/row:4/tee-column:0", evidence: null, outcome: "excluded", reason: "invalid_row_shape" }
] };
const service = () => ({ list: jest.fn().mockResolvedValue({ items: [batch], total: 1, offset: 0 }), detail: jest.fn().mockResolvedValue(detail) });

test("archive is lazy/read-only, shows receipt, values, incomplete limits and exclusions without certification", async () => {
  const api = service(); render(<TeeEvidence service={api} />);
  expect(api.list).not.toHaveBeenCalled(); expect(screen.queryByText("0 batch registrati")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Consulta batch evidenze" }));
  expect(await screen.findByText("1 batch registrati")).toBeInTheDocument();
  fireEvent.click(within(screen.getByLabelText("Batch evidenze tee")).getByRole("button"));
  expect(await screen.findByText("Approvazione esplicita fixture")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Club fixture · GIALLO/ }));
  expect(screen.getByText("72 → 72")).toBeInTheDocument();
  expect(screen.getByText("Applicabilità non attestabile dalle intestazioni conservate")).toBeInTheDocument();
  expect(screen.getByText("Par comune alla configurazione, non dichiarato per il singolo tee")).toBeInTheDocument();
  expect(screen.getByText("Una prova completa non costituisce automaticamente un’attestazione certificata.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Osservazione esclusa/ }));
  expect(screen.getAllByText("Struttura della riga non supportata").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /Conferma|Classifica|Pubblica|Carica artefatto/i })).not.toBeInTheDocument();
  expect(api.detail).toHaveBeenCalledWith(batch.id, 0);
  fireEvent.click(screen.getByRole("button", { name: "Torna ai batch" }));
  await screen.findByText("1 batch registrati");
});
test("empty and failed archive reads are distinct, retry never presents failure as zero batches", async () => {
  const api=service();api.list.mockRejectedValueOnce(new Error("Fixture read denied"));
  const consoleError=jest.spyOn(console,"error").mockImplementation(()=>{});
  render(<TeeEvidence service={api} />);fireEvent.click(screen.getByRole("button",{name:"Consulta batch evidenze"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Impossibile caricare");
  expect(screen.queryByText("Nessun batch di evidenze registrato.")).not.toBeInTheDocument();
  api.list.mockResolvedValue({items:[],total:0,offset:0});fireEvent.click(screen.getByRole("button",{name:"Riprova"}));
  expect(await screen.findByText("Nessun batch di evidenze registrato.")).toBeInTheDocument();consoleError.mockRestore();
});
test("receipt pagination requests next page and shows the matching observation, not just first 100", async()=>{
  const api=service();api.detail.mockImplementation(async(id,offset)=>offset===0?{...detail,batch:{...detail.batch,total:101},items:Array.from({length:100},(_,i)=>({...detail.items[0],observation_id:`reference-${i}`,evidence:{...evidence,club_label:`Fixture ${i}`}}))}:{...detail,batch:{...detail.batch,total:101},offset:100,items:[{...detail.items[0],evidence:{...evidence,club_label:"Last fixture"}}]});
  render(<TeeEvidence service={api}/>);fireEvent.click(screen.getByRole("button",{name:"Consulta batch evidenze"}));
  fireEvent.click(await screen.findByRole("button",{name:/Fonte \/ estrattore FIG/}));
  fireEvent.click(await screen.findByRole("button",{name:"Successivi"}));
  expect(await screen.findByText("Last fixture · GIALLO")).toBeInTheDocument();expect(api.detail).toHaveBeenLastCalledWith(batch.id,100);
});
test("browser service has only two allowlisted read RPCs and propagates errors",async()=>{
  const client={rpc:jest.fn().mockResolvedValue({data:{items:[],total:0,offset:0}})},api=createTeeEvidenceService(client);
  expect(Object.keys(api)).toEqual(["list","detail"]);await api.list();await api.detail("batch",100);
  expect(client.rpc.mock.calls).toEqual([["admin_catalog_tee_evidence_list",{p_offset:0}],["admin_catalog_tee_evidence_detail",{p_batch_id:"batch",p_offset:100}]]);
  client.rpc.mockResolvedValue({error:{code:"42501"}});await expect(api.list()).rejects.toEqual({code:"42501"});
});
test("archive is accessible inside Structure and links without a new sidebar or mutating control",async()=>{
  const api=service(),review={teeEvidence:api,list:jest.fn().mockResolvedValue([])};
  render(<StructureReview service={review} onRoot={jest.fn()} />);
  expect(screen.getByRole("heading",{name:"Archivio evidenze tee"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Consulta batch evidenze"}));
  await waitFor(()=>expect(api.list).toHaveBeenCalledTimes(1));
});
test("read-only UI never renders extra raw/path/signed URL/payload/secret fields or offers download",async()=>{
  const api=service();
  const privateFields={object_path:"PRIVATE_RAW_PATH",signed_url:"PRIVATE_SIGNED_URL",source_payload:{secret:"PRIVATE_SECRET"},raw_bytes:"PRIVATE_RAW_BYTES",extraction_manifest:{secret:"PRIVATE_MANIFEST"}};
  api.detail.mockResolvedValue({...detail,...privateFields,artifact:{...detail.artifact,...privateFields},items:detail.items.map(item=>({...item,...privateFields,evidence:item.evidence?{...item.evidence,...privateFields}:null}))});
  render(<TeeEvidence service={api}/>);fireEvent.click(screen.getByRole("button",{name:"Consulta batch evidenze"}));
  fireEvent.click(await screen.findByRole("button",{name:/Fonte \/ estrattore FIG/}));
  fireEvent.click(await screen.findByRole("button",{name:/Club fixture · GIALLO/}));
  for(const forbidden of ["PRIVATE_RAW_PATH","PRIVATE_SIGNED_URL","PRIVATE_SECRET","PRIVATE_RAW_BYTES","PRIVATE_MANIFEST"])expect(document.body).not.toHaveTextContent(forbidden);
  expect(screen.queryByRole("button",{name:/Scarica|Download|Conferma|Upload/i})).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

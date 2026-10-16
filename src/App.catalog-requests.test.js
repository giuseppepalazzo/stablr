import {StrictMode} from 'react';
import {act,fireEvent,render,waitFor} from '@testing-library/react';
import App from './App';
import {supabase} from './lib/supabase';
import {AdminShell} from './admin/AdminApp';

jest.mock('./lib/supabase',()=>({hasSupabaseConfig:true,supabase:{from:jest.fn(),rpc:jest.fn(),auth:{getSession:jest.fn(),onAuthStateChange:jest.fn()}}}));
let authChanged,visibility,descriptor;
const session={user:{id:'user-fixture'},access_token:'TEST-ONLY-token'};
const count=table=>supabase.from.mock.calls.filter(([name])=>name===table).length;

beforeEach(()=>{
  jest.useFakeTimers();jest.setSystemTime(new Date('2026-10-16T12:00:00Z'));
  descriptor=Object.getOwnPropertyDescriptor(document,'visibilityState');visibility='visible';
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});
  localStorage.clear();supabase.from.mockReset();supabase.rpc.mockReset();
  supabase.auth.getSession.mockResolvedValue({data:{session}});
  supabase.auth.onAuthStateChange.mockImplementation(callback=>{authChanged=callback;return {data:{subscription:{unsubscribe:jest.fn()}}};});
  supabase.rpc.mockResolvedValue({data:null,error:{code:'PGRST202'}}); // Missing activity RPC must not cause focus retries.
  supabase.from.mockImplementation(table=>{
    const result={data:table==='profiles'?{id:'user-fixture',player_name:'',hcp:36,role:'user'}:[],error:null};
    const q={then:(yes,no)=>Promise.resolve(result).then(yes,no)};
    for(const name of ['select','eq','in','range','order','limit','maybeSingle'])q[name]=jest.fn(()=>q);
    return q;
  });
});
afterEach(()=>{jest.useRealTimers();if(descriptor)Object.defineProperty(document,'visibilityState',descriptor);else delete document.visibilityState;});

test('one catalog bootstrap in StrictMode; idle UI, focus and token events for the same user do not reload it',async()=>{
  render(<StrictMode><App/></StrictMode>);
  await waitFor(()=>expect(count('profiles')).toBe(1));expect(count('clubs')).toBe(1);expect(count('favorite_clubs')).toBe(1);expect(count('rounds')).toBe(1);
  await act(async()=>{authChanged('TOKEN_REFRESHED',{...session,access_token:'TEST-ONLY-refreshed'});});
  await act(async()=>{authChanged('SIGNED_IN',{...session,user:{...session.user}});});
  fireEvent.focus(window);visibility='hidden';fireEvent(document,new Event('visibilitychange'));visibility='visible';fireEvent(document,new Event('visibilitychange'));
  await act(async()=>{jest.advanceTimersByTime(60*60*1000);});
  expect(count('clubs')).toBe(1);expect(count('profiles')).toBe(1);expect(count('rounds')).toBe(1);
});

test('different user creates a fresh load; failed activity attempts still respect fifteen minutes',async()=>{
  render(<App/>);await waitFor(()=>expect(count('profiles')).toBe(1));
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  for(let i=0;i<10;i++)fireEvent.focus(window);await act(async()=>{});expect(supabase.rpc).toHaveBeenCalledTimes(1);
  await act(async()=>{jest.advanceTimersByTime(15*60*1000);});expect(supabase.rpc).toHaveBeenCalledTimes(2);
  await act(async()=>{authChanged('SIGNED_IN',{user:{id:'other-user'}});});
  await waitFor(()=>expect(count('profiles')).toBe(2));expect(count('clubs')).toBe(2);
});

test('Admin StrictMode coalesces the initial batch and sidebar navigation never reloads the catalog',async()=>{
  supabase.rpc.mockResolvedValue({data:[],error:null});
  render(<StrictMode><AdminShell onSignOut={jest.fn()}/></StrictMode>);
  await waitFor(()=>expect(count('clubs')).toBe(1));await act(async()=>{});
  expect(count('rounds')).toBe(1);expect(supabase.rpc).toHaveBeenCalledTimes(1);
  const {screen,within}=require('@testing-library/react');
  const nav=within(screen.getByRole('navigation',{name:'Navigazione amministrazione'}));
  fireEvent.click(nav.getByRole('button',{name:'Club e percorsi'}));fireEvent.click(nav.getByRole('button',{name:'Panoramica'}));
  await act(async()=>{jest.advanceTimersByTime(60*60*1000);});expect(count('clubs')).toBe(1);
});

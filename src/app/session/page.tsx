import Session from '@/components/Session';
export const dynamic='force-dynamic';
export default function SessionPage(){return <Session demoMode={process.env.DEMO_MODE==='1'}/>;}

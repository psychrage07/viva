import Link from 'next/link';
import { Brand } from '@/components/Brand';
export default function NotFound(){return <main className="error-box"><Brand/><h1 style={{marginTop:30}}>A little off the learning path.</h1><p>This page doesn’t exist. Your next aha! moment is waiting back at Viva.</p><Link className="button" href="/">Find my way back</Link></main>;}

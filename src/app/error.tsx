'use client';
import Link from 'next/link';
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="error-box"><h1>Let’s take a fresh breath.</h1><p>This page couldn’t finish loading. Your saved session may still be in this tab. You can try again without clearing it.</p><button className="button" onClick={reset}>Try again</button><p style={{marginTop:20}}><Link href="/">Back to Viva</Link></p></main>;}

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DM_Sans, DM_Serif_Display } from 'next/font/google';
import './globals.css';
const dmSans = DM_Sans({ subsets: ['latin'], weight: ['400','500','600','700','800'], variable: '--font-dm-sans', display: 'swap' });
const dmSerif = DM_Serif_Display({ subsets: ['latin'], weight: '400', variable: '--font-dm-serif', display: 'swap' });
export const metadata:Metadata={title:'Viva — Learn it better. Teach it to Viva.',icons:{icon:'/icon.svg'},description:'Meet the AI student that helps you see what you understand. Teach, discover, and find your aha! moment. Speak or type. No account needed.'};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en" className={`${dmSans.variable} ${dmSerif.variable}`}><body><a className="skip-link" href="#main-content">Skip to content</a><div id="main-content">{children}</div></body></html>;}

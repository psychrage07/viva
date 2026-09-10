import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
export const metadata:Metadata={title:'Viva — Learn it better. Teach it to Viva.',icons:{icon:'/icon.svg'},description:'Meet the AI student that helps you see what you understand. Teach, discover, and find your aha! moment. Speak or type. No account needed.'};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to content</a><div id="main-content">{children}</div></body></html>;}

import Link from 'next/link';
export function Spark({className=''}:{className?:string}) { return <svg className={className} width="30" height="34" viewBox="0 0 30 34" fill="none" aria-hidden="true"><path d="M15 0C16.9 10.6 19.7 13.7 30 17C19.7 19.1 16.8 23.5 15 34C13.1 23.6 10.1 19.5 0 17C10.2 14.6 13.1 10.5 15 0Z" fill="currentColor"/></svg> }
export function Brand() { return <Link className="brand" href="/" aria-label="Viva home"><Spark/>viva<span className="brand-dot">®</span></Link>; }

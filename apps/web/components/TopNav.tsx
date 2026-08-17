'use client';

import { useEffect, useState } from 'react';
import SearchBox from './SearchBox';

function nowUTC(): string {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds());
}

function Clock() {
  const [t, setT] = useState<string | null>(null);
  useEffect(() => {
    setT(nowUTC());
    const id = setInterval(() => setT(nowUTC()), 1000);
    return () => clearInterval(id);
  }, []);
  return <div className="clock">{t ? t + ' UTC' : '--:--:-- UTC'}</div>;
}

export default function TopNav() {
  return (
    <div className="topnav">
      <div className="brand">
        <div className="logo"><i></i><i></i><i></i></div>
        <b>VOLDECK</b>
        <span>Chain Volume Terminal</span>
      </div>
      <div className="sp"></div>
      <SearchBox />
      <Clock />
      <div className="live"><span className="ld"></span>Live</div>
    </div>
  );
}

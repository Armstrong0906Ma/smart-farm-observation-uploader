'use client';

import { AuthProvider, useAuth } from '@/components/AuthProvider';
import { ImportObservations } from '@/components/ImportObservations';
import { ObservationForm } from '@/components/ObservationForm';
import { RecentObservations } from '@/components/RecentObservations';

function HomeContent() {
  const { user, loading, authError, signIn, signOut } = useAuth();

  if (loading) {
    return <main className="shell"><div className="card">載入中...</div></main>;
  }

  if (!user) {
    return (
      <main className="loginShell">
        <section className="heroCard">
          <p className="eyebrow">Smart Farm DataHub Uploader</p>
          <h1>智慧農場植株觀測資料上傳</h1>
          <p className="muted">登入後即可用手機輸入觀測資料，系統會先存入資料庫，再上傳到 WISE-PaaS/DataHub。</p>
          {authError && <div className="notice error">{authError}</div>}
          <button className="primaryButton" onClick={signIn} disabled={Boolean(authError)}>使用 Google 登入</button>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">NTU Smart Farm</p>
          <h1>植株觀測上傳</h1>
        </div>
        <button className="ghostButton" onClick={signOut}>登出</button>
      </header>
      <div className="grid">
        <div className="stack">
          <ObservationForm />
          <ImportObservations />
        </div>
        <RecentObservations />
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <HomeContent />
    </AuthProvider>
  );
}

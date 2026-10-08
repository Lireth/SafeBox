import { useState } from 'react'

function App(): React.JSX.Element {
  const [versions] = useState(() => window.electronAPI?.versions)

  return (
    <main className="container">
      <h1>秘匣</h1>
      <p className="subtitle">SafeBox · Electron + TypeScript + React + Vite 已就绪</p>
      {versions && (
        <ul className="versions">
          <li>Electron: {versions.electron}</li>
          <li>Chromium: {versions.chrome}</li>
          <li>Node: {versions.node}</li>
        </ul>
      )}
    </main>
  )
}

export default App

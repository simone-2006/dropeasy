import { useEffect, useState } from 'react'
import { ArrowDownToLine, X } from 'lucide-react'

async function readError(res) {
  try {
    const body = await res.json()
    if (body?.detail) return String(body.detail)
  } catch {
    /* risposta non JSON */
  }
  return 'Il server non ha risposto. Avvialo sulla porta 8000.'
}

function formatSize(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const shown =
    unit === 0
      ? String(Math.round(value))
      : value.toLocaleString('it-IT', { maximumFractionDigits: 1 })
  return `${shown} ${units[unit]}`
}

function Spinner() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-30" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  )
}

const primaryButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-semibold text-on-brand transition hover:bg-brand-hover active:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:bg-brand/45'

const secondaryButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-5 text-sm font-semibold text-foreground transition hover:bg-background active:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:text-muted'

function App() {
  const [session, setSession] = useState(null)
  const [files, setFiles] = useState([])
  const [downloaded, setDownloaded] = useState([])
  const [hiding, setHiding] = useState(() => new Set())
  const [error, setError] = useState(null)
  const [starting, setStarting] = useState(false)

  const received = files.filter((file) => !hiding.has(file.name))

  async function start() {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/session', { method: 'POST' })
      if (!res.ok) throw new Error(await readError(res))
      setDownloaded([])
      setHiding(new Set())
      setSession(await res.json())
    } catch (err) {
      setError(err.message || 'Impossibile avviare la condivisione')
    } finally {
      setStarting(false)
    }
  }

  useEffect(() => {
    let stop = false
    fetch('/api/session')
      .then(async (res) => {
        if (!res.ok || stop) return
        setSession(await res.json())
      })
      .catch(() => { })
    return () => {
      stop = true
    }
  }, [])

  useEffect(() => {
    if (!session) return
    let stop = false

    async function poll() {
      try {
        const res = await fetch('/api/files')
        if (!res.ok || stop) return
        const incoming = await res.json()
        setFiles(incoming)
        const names = new Set(incoming.map((file) => file.name))
        setHiding((current) => {
          const next = new Set([...current].filter((name) => names.has(name)))
          return next.size === current.size ? current : next
        })
      } catch {
        /* il pannello riprova al giro successivo */
      }
    }

    poll()
    const id = setInterval(poll, 2000)
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [session])

  function downloadFile(file) {
    const link = document.createElement('a')
    link.href = `/api/files/${encodeURIComponent(file.name)}`
    link.download = file.name
    link.click()
    setHiding((current) => new Set(current).add(file.name))
    setDownloaded((current) => [file, ...current.filter((item) => item.name !== file.name)])
  }

  async function removeReceived(name) {
    setError(null)
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await readError(res))
      setFiles((current) => current.filter((file) => file.name !== name))
      setHiding((current) => {
        if (!current.has(name)) return current
        const next = new Set(current)
        next.delete(name)
        return next
      })
    } catch (err) {
      setError(err.message || 'Impossibile eliminare il file')
    }
  }

  function removeDownloaded(name) {
    setDownloaded((current) => current.filter((file) => file.name !== name))
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col bg-background px-4 py-10 text-foreground sm:px-6 sm:py-16">
      <header className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-brand text-on-brand">
          <ArrowDownToLine />
        </span>
        <div>
          <h1 className="font-display text-4xl leading-none font-semibold tracking-tight">DropEasy</h1>
          <p className="mt-2 text-base text-muted">Passa file dal telefono a questo PC.</p>
        </div>
      </header>

      {!session ? (
        <section className="mt-10 rounded-md border border-border bg-surface px-6 py-8">
          <h2 className="font-display text-2xl">Pronto a ricevere</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Avvia la condivisione, poi inquadra il QR con il telefono sulla stessa rete.
          </p>
          <button type="button" onClick={start} disabled={starting} className={`${primaryButton} mt-6`}>
            {starting ? <Spinner /> : null}
            {starting ? 'Avvio…' : 'Inizia condivisione'}
          </button>
        </section>
      ) : (
        <section className="mt-10 flex flex-col">
          <div className="px-6 py-7">
            <p className="text-center text-xs font-medium tracking-[0.16em] text-brand-deep uppercase">Condivisione attiva</p>
            <img
              src={`/api/qr?u=${encodeURIComponent(session.url)}`}
              alt="QR code da inquadrare con il telefono"
              className="mx-auto mt-4 w-56 rounded-md bg-surface"
            />
            <p className="mt-4 text-center text-sm leading-6 text-muted">
              Inquadra il QR dal telefono, oppure apri questo indirizzo.
            </p>
            <a
              href={session.url}
              className="mt-3 block break-all rounded-md border border-border bg-surface-muted px-4 py-3 text-center text-sm text-foreground underline decoration-border underline-offset-4 transition hover:border-brand hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              {session.url}
            </a>
          </div>

          <div className="mt-8 flex items-baseline justify-between gap-4">
            <h2 className="font-display text-2xl">File ricevuti</h2>
          </div>

          {received.length === 0 ? (
            downloaded.length === 0 ? (
              <div className="mt-3 rounded-md border border-dashed border-border-strong bg-surface/70 px-6 py-10 text-center">
                <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
                  <ArrowDownToLine />
                </span>
                <p className="mt-3 font-medium text-foreground">Nessun file ancora</p>
                <p className="mt-1 text-sm text-muted">Quando il telefono invia un file, compare qui.</p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">Nessun file in attesa.</p>
            )
          ) : (
            <ul className="mt-3 divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
              {received.map((file) => (
                <li key={file.name} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-foreground" title={file.name}>{file.name}</p>
                    {formatSize(file.size) ? (
                      <p className="text-sm text-muted">{formatSize(file.size)}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadFile(file)}
                    aria-label={`Scarica ${file.name}`}
                    className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md bg-brand text-on-brand transition hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    <ArrowDownToLine size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeReceived(file.name)}
                    aria-label={`Elimina ${file.name}`}
                    className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    <X size={18} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {downloaded.length > 0 ? (
            <div className="mt-8">
              <h2 className="font-display text-2xl">File scaricati</h2>
              <ul className="mt-3 divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
                {downloaded.map((file) => (
                  <li key={file.name} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1 opacity-45">
                      <p className="truncate text-foreground" title={file.name}>{file.name}</p>
                      {formatSize(file.size) ? (
                        <p className="text-sm text-muted">{formatSize(file.size)}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDownloaded(file.name)}
                      aria-label={`Elimina ${file.name} dai scaricati`}
                      className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      <X size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <button type="button" onClick={start} disabled={starting} className={`${secondaryButton} mt-6 self-start`}>
            {starting ? <Spinner /> : null}
            {starting ? 'Avvio…' : 'Nuova condivisione'}
          </button>
        </section>
      )}

      {error ? (
        <p role="alert" className="mt-6 flex items-start gap-3 rounded-md border border-danger-border bg-danger-soft px-4 py-3 text-sm leading-6 text-danger">
          <span aria-hidden="true" className="mt-0.5 font-semibold">!</span>
          <span>{error}</span>
        </p>
      ) : null}
    </main>
  )
}

export default App

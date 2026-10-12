import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowUpFromLine } from 'lucide-react'
import './index.css'

const token = new URLSearchParams(location.search).get('t')

const primaryButton =
    'inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-semibold text-on-brand transition hover:bg-brand-hover active:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:bg-brand/45'

function isFileDrag(event) {
    const types = event.dataTransfer?.types
    if (!types) return false
    return Array.from(types).includes('Files')
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

function uploadFile(file, onProgress) {
    return new Promise((resolve) => {
        const body = new FormData()
        body.append('file', file)
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `/upload?t=${encodeURIComponent(token)}`)
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
        }
        xhr.onload = () => {
            if (xhr.status === 200) resolve('ok')
            else if (xhr.status === 403) resolve('denied')
            else resolve('error')
        }
        xhr.onerror = () => resolve('network')
        xhr.send(body)
    })
}

function statusLabel(row) {
    if (row.status === 'ok') return 'Inviato'
    if (row.status === 'denied') return 'Link non valido'
    if (row.status === 'network') return 'Errore di rete'
    if (row.status === 'error') return 'Non inviato'
    return `${row.progress}%`
}

function Send() {
    const inputRef = useRef(null)
    const dragDepth = useRef(0)
    const [gate, setGate] = useState(token ? 'checking' : 'bad')
    const [chosen, setChosen] = useState([])
    const [rows, setRows] = useState([])
    const [sending, setSending] = useState(false)
    const [dragging, setDragging] = useState(false)

    useEffect(() => {
        if (!token) return
        let stop = false
        let wasValid = false

        async function checkInvite() {
            try {
                const res = await fetch(`/api/invite?t=${encodeURIComponent(token)}`, { cache: 'no-store' })
                if (stop) return
                if (res.ok) {
                    wasValid = true
                    setGate('ok')
                    return
                }
                setGate(wasValid ? 'replaced' : 'bad')
            } catch {
                if (!stop && !wasValid) setGate('bad')
            }
        }

        checkInvite()
        const id = setInterval(checkInvite, 2000)
        return () => {
            stop = true
            clearInterval(id)
        }
    }, [])

    useEffect(() => {
        function show() {
            dragDepth.current += 1
            if (dragDepth.current === 1) setDragging(true)
        }
        function hide() {
            dragDepth.current = Math.max(0, dragDepth.current - 1)
            if (dragDepth.current === 0) setDragging(false)
        }
        function onEnter(event) {
            if (!isFileDrag(event)) return
            event.preventDefault()
            show()
        }
        function onOver(event) {
            if (!isFileDrag(event)) return
            event.preventDefault()
        }
        function onLeave(event) {
            if (!isFileDrag(event)) return
            hide()
        }
        function onDrop(event) {
            if (!isFileDrag(event)) return
            event.preventDefault()
            dragDepth.current = 0
            setDragging(false)
            if (gate !== 'ok' || sending) return
            const files = Array.from(event.dataTransfer.files || [])
            if (files.length) setChosen(files)
        }

        window.addEventListener('dragenter', onEnter)
        window.addEventListener('dragover', onOver)
        window.addEventListener('dragleave', onLeave)
        window.addEventListener('drop', onDrop)
        return () => {
            window.removeEventListener('dragenter', onEnter)
            window.removeEventListener('dragover', onOver)
            window.removeEventListener('dragleave', onLeave)
            window.removeEventListener('drop', onDrop)
        }
    }, [gate, sending])

    async function submit() {
        const files = chosen
        if (!files.length || sending) return
        setSending(true)
        const pending = files.map((file, index) => ({
            id: `${file.name}-${file.size}-${index}`,
            name: file.name,
            size: file.size,
            progress: 0,
            status: 'sending',
        }))
        setRows((current) => [...pending, ...current])
        setChosen([])
        if (inputRef.current) inputRef.current.value = ''

        for (let index = 0; index < files.length; index += 1) {
            const id = pending[index].id
            const result = await uploadFile(files[index], (progress) => {
                setRows((current) => current.map((row) => (row.id === id ? { ...row, progress } : row)))
            })
            setRows((current) =>
                current.map((row) =>
                    row.id === id
                        ? { ...row, progress: result === 'ok' ? 100 : row.progress, status: result }
                        : row,
                ),
            )
            if (result === 'denied') {
                setGate('replaced')
                break
            }
        }
        setSending(false)
    }

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col bg-background px-4 py-10 text-foreground sm:px-6 sm:py-16">
            <header className="flex items-start gap-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-brand text-on-brand">
                    <ArrowUpFromLine />
                </span>
                <div>
                    <h1 className="font-display text-4xl leading-none font-semibold tracking-tight">DropEasy</h1>
                    <p className="mt-2 text-base text-muted">Invia file al PC.</p>
                </div>
            </header>

            {gate === 'checking' ? (
                <p className="mt-10 text-sm text-muted">Controllo del link…</p>
            ) : null}

            {gate === 'bad' || gate === 'replaced' ? (
                <p role="alert" className="mt-10 rounded-md border border-danger-border bg-danger-soft px-4 py-3 text-sm leading-6 text-danger">
                    {gate === 'replaced'
                        ? 'Questo link non funziona più: la condivisione è scaduta oppure sul PC ne è stata avviata una nuova. Inquadra di nuovo il QR.'
                        : 'Questo link non è valido. Inquadra di nuovo il QR dal computer.'}
                </p>
            ) : null}

            {gate === 'ok' ? (
                <section className="mt-10 rounded-md border border-border bg-surface px-6 py-8">
                    <h2 className="font-display text-2xl">File da inviare</h2>
                    <p className="mt-2 text-sm leading-6 text-muted">
                        Trascina i file in qualsiasi punto della pagina. Restano sul PC solo dopo l’invio.
                    </p>
                    <label className="mt-6 flex cursor-pointer flex-col items-center rounded-md border border-dashed border-border-strong px-4 py-8 text-center transition hover:border-brand hover:bg-brand-soft">
                        <ArrowUpFromLine className="text-brand-deep" aria-hidden="true" />
                        <span className="mt-3 text-sm font-medium">Tocca per scegliere</span>
                        <input
                            ref={inputRef}
                            type="file"
                            multiple
                            className="sr-only"
                            onChange={(event) => setChosen(Array.from(event.target.files || []))}
                        />
                    </label>
                    {chosen.length > 0 ? (
                        <ul className="mt-4 divide-y divide-border rounded-md border border-border">
                            {chosen.map((file, index) => (
                                <li key={`${file.name}-${index}`} className="px-3 py-3">
                                    <p className="truncate text-sm font-medium">{file.name}</p>
                                    <p className="text-sm text-muted">{formatSize(file.size)}</p>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="mt-4 text-sm text-muted">Nessun file scelto.</p>
                    )}
                    <button type="button" onClick={submit} disabled={sending || chosen.length === 0} className={`${primaryButton} mt-6`}>
                        {sending ? 'Invio…' : 'Invia'}
                    </button>
                    <a href="/" className="mt-4 text-sm text-brand underline custor-pointer">Torna indietro</a>
                </section>
            ) : null}

            {rows.length > 0 ? (
                <section className="mt-8">
                    <h2 className="font-display text-2xl">Invio</h2>
                    <ul className="mt-3 divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
                        {rows.map((row) => {
                            const failed = row.status === 'error' || row.status === 'denied' || row.status === 'network'
                            return (
                                <li key={row.id} className="px-4 py-3">
                                    <div className="flex items-baseline justify-between gap-3">
                                        <p className="min-w-0 truncate text-sm font-medium" title={row.name}>{row.name}</p>
                                        <p className={`shrink-0 text-sm ${failed ? 'text-danger' : row.status === 'ok' ? 'text-success' : 'text-muted'}`}>
                                            {statusLabel(row)}
                                        </p>
                                    </div>
                                    <div
                                        role="progressbar"
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-valuenow={row.progress}
                                        aria-label={row.name}
                                        className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-soft"
                                    >
                                        <div
                                            className={`h-full ${failed ? 'bg-danger' : 'bg-success'}`}
                                            style={{ width: `${row.progress}%` }}
                                        />
                                    </div>
                                </li>
                            )
                        })}
                    </ul>
                </section>
            ) : null}

            <div
                className={`pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-6 transition-opacity duration-200 ease-out ${dragging ? 'opacity-100' : 'opacity-0'}`}
                aria-hidden={dragging ? undefined : true}
            >
                <div className="absolute inset-0 bg-background/80" />
                <div
                    className={`relative flex w-full max-w-sm flex-col items-center rounded-md border-2 border-dashed border-brand bg-brand-soft px-6 py-12 text-center transition-transform duration-200 ease-out ${dragging ? 'scale-100' : 'scale-95'}`}
                >
                    <span className="flex size-14 items-center justify-center rounded-md bg-brand text-on-brand">
                        <ArrowUpFromLine aria-hidden="true" />
                    </span>
                    <p className="font-display mt-4 text-3xl text-foreground">Rilascia i file</p>
                    <p className="mt-2 text-sm text-muted">Li aggiungo a quelli da inviare.</p>
                </div>
            </div>
        </main>
    )
}

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <Send />
    </StrictMode>,
)

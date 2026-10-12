import { useEffect, useState } from 'react'

async function readError(res) {
  try {
    const body = await res.json()
    if (body?.detail) return String(body.detail)
  } catch {
    /* risposta non JSON */
  }
  return 'Il server non ha risposto. Avvialo sulla porta 8000.'
}

function App() {
  const [session, setSession] = useState(null)
  const [files, setFiles] = useState([])
  const [error, setError] = useState(null)
  const [starting, setStarting] = useState(false)

  async function start() {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/session', { method: 'POST' })
      if (!res.ok) throw new Error(await readError(res))
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
        if (res.ok && !stop) setFiles(await res.json())
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

  function downloadFile(name) {
    const link = document.createElement('a')
    link.href = `/api/files/${encodeURIComponent(name)}`
    link.download = name
    link.click()
  }

  return (
    <main>
      <div className="flex flex-col items-center px-20 py-5">
        <h1 className='font-bold text-xl'>DropEasy</h1>
        <p className='text-sm text-gray-600'>Passa file dal telefono a questo PC.</p>


        {!session ? (
          <button
            type="button"
            onClick={start}
            disabled={starting}
            className={
              'bg-amber-600 text-white font-semibold px-2 py-1 rounded-md shadow transition mt-3 cursor-pointer ' +
              (starting
                ? 'opacity-60 cursor-not-allowed'
                : 'hover:bg-amber-700 active:bg-amber-800')
            }
          >
   
            {starting ? 'Avvio…' : 'Inizia condivisione'}
          </button>
        ) : (
          <section className='flex flex-col items-center'>
            <img
              src={`/api/qr?u=${encodeURIComponent(session.url)}`}
              alt="QR code da inquadrare con il telefono"
              className='w-60'
            />
            <p className='text-sm text-gray-600'>Inquadra il QR dal telefono, oppure apri questo indirizzo.</p>
            <a className='text-blue-500 underline cursor-pointer hover:text-blue-600 ' href={session.url}>{session.url}</a>
            <h2 className="text-lg font-semibold mb-2 mt-4">File ricevuti</h2>
            <div className="w-full max-w-lg">
              {files.length === 0 ? (
                <p className="text-gray-500 text-center py-4 border rounded">Nessun file ancora.</p>
              ) : (
                <table className="w-full border rounded shadow mt-2 bg-white">
                  <thead>
                    <tr className="bg-amber-50">
                      <th className="py-2 px-3 text-left font-medium border-b">Nome file</th>
                      <th className="py-2 px-3 text-left font-medium border-b">Azione</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((file) => (
                      <tr key={file.name} className="hover:bg-amber-100 transition">
                        <td className="py-2 px-3 border-b">{file.name}</td>
                        <td className="py-2 px-3 border-b">
                          <button
                            type="button"
                            onClick={() => downloadFile(file.name)}
                            className="bg-amber-600 text-white px-3 py-1 rounded hover:bg-amber-700 transition"
                          >
                            Download
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
       
            <button
              type="button"
              onClick={start}
              disabled={starting}
              className={
                'bg-amber-500 text-white font-semibold px-2 py-1 rounded-md shadow transition mt-3 cursor-pointer ' +
                (starting
                  ? 'opacity-60 cursor-not-allowed'
                  : 'hover:bg-amber-600 active:bg-amber-700')
              }
            >
              {starting ? 'Avvio…' : 'Nuova condivisione'}
            </button>
       
          </section>
        )}

        {error ? <p role="alert">{error}</p> : null}
      </div>
    </main>
  )
}

export default App

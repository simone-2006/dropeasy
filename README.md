# DropEasy

Passa file dal telefono a questo PC. Dal computer avvii una condivisione, inquadri il QR con il telefono e invii i file: compaiono nel pannello e li scarichi in locale.

## Funzionalità

- Avvio di una sessione di condivisione dal PC, protetta da un token
- QR code e link da aprire sul telefono, sulla stessa rete
- Invio di uno o più file dal telefono, con avanzamento
- Elenco dei file ricevuti e download sul PC
- Nuova condivisione, che sostituisce il token precedente

## Tecnologie utilizzate

- React, Vite, Tailwind CSS
- Python, FastAPI, Uvicorn
- qrcode
- File temporanei in locale; Vercel Blob quando l’app è deployata



## Installazione

```bash
git clone https://github.com/simone-2006/dropeasy.git
cd dropeasy
npm install
cd frontend
npm install
cd ../server
pip install -r requirements.txt
```

Python 3.13.

## Avvio

```bash
npm start
```

Il pannello è su [http://localhost:5173](http://localhost:5173). Il server ascolta sulla porta 8000.

## Deploy su Vercel

Collega un Blob store al progetto (`BLOB_READ_WRITE_TOKEN`). Opzionale: `MAX_UPLOAD_BYTES` (default 50 MB).

## Screenshot

![](screenshot/dropeasy-screenshot.png)

## Autore

**Simone Penza**

[GitHub](https://github.com/simone-2006)
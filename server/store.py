import os
from pathlib import Path

FILE_PREFIX = "dropeasy/files/"
SESSION_PATH = "dropeasy/session"


def blob_enabled() -> bool:
    return bool(os.getenv("BLOB_READ_WRITE_TOKEN"))


def on_vercel() -> bool:
    return bool(os.getenv("VERCEL"))


class BlobStore:
    def __init__(self):
        self._client = None

    async def client(self):
        if self._client is None:
            from vercel.blob import AsyncBlobClient

            self._client = AsyncBlobClient()
        return self._client

    async def read_session(self) -> str | None:
        from vercel.blob import BlobNotFoundError

        try:
            result = await (await self.client()).get(SESSION_PATH, access="private")
        except BlobNotFoundError:
            return None
        if result is None or not result.content:
            return None
        return result.content.decode()

    async def write_session(self, token: str) -> None:
        await (await self.client()).put(
            SESSION_PATH,
            token.encode(),
            access="private",
            overwrite=True,
            add_random_suffix=False,
            content_type="text/plain",
        )

    async def list_files(self) -> list[dict]:
        result = await (await self.client()).list_objects(prefix=FILE_PREFIX, limit=1000)
        items = []
        for blob in result.blobs:
            name = blob.pathname.removeprefix(FILE_PREFIX)
            if not name or "/" in name:
                continue
            items.append((blob.uploaded_at, {"name": name, "size": blob.size}))
        items.sort(key=lambda item: item[0], reverse=True)
        return [item[1] for item in items]

    async def save_file(self, name: str, data: bytes) -> str:
        taken = {item["name"] for item in await self.list_files()}
        dest = name
        stem = Path(name).stem
        suffix = Path(name).suffix
        i = 1
        while dest in taken:
            dest = f"{stem}_{i}{suffix}"
            i += 1
        await (await self.client()).put(
            FILE_PREFIX + dest,
            data,
            access="private",
            overwrite=False,
            add_random_suffix=False,
            content_type="application/octet-stream",
        )
        return dest

    async def read_file(self, name: str) -> bytes:
        from vercel.blob import BlobNotFoundError

        try:
            result = await (await self.client()).get(FILE_PREFIX + name, access="private")
        except BlobNotFoundError:
            result = None
        if result is None or result.content is None:
            raise FileNotFoundError(name)
        return result.content

    async def delete_file(self, name: str) -> None:
        await (await self.client()).delete(FILE_PREFIX + name)


store = BlobStore()

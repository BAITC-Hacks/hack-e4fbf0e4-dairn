"""Run with python -m app.worker. Jobs survive API/worker restarts."""
import asyncio
import json
import logging
import os
import signal
import sys
import time
from pathlib import Path

from app.core.config import Settings
from app.core.errors import DomainError
from app.domain.chat.service import answer_message
from app.runtime import Runtime

logger=logging.getLogger(__name__)


async def parse_attachment(rt,data):
    path=Path(data['_path'])
    process=None
    try:
        process=await asyncio.create_subprocess_exec(sys.executable,'-m','app.domain.attachments.parser',str(path),rt.settings.ocr_languages,
            stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,start_new_session=True)
        stdout,_=await asyncio.wait_for(process.communicate(),timeout=75)
        result=json.loads(stdout)
        if process.returncode or result.get('error'):
            raise DomainError(422,'extraction_failed',result.get('error','Unable to extract attachment'))
        return {**data,'status':'ready','_blocks':result['blocks'],'blocks_count':len(result['blocks']),
                'warnings':result['warnings'],'error':None}
    finally:
        if process and process.returncode is None:
            os.killpg(process.pid,signal.SIGKILL)
            await process.wait()
        # Original binary is never retained after processing, including errors/timeouts.
        path.unlink(missing_ok=True)


async def process_one(rt):
    job=rt.store.claim()
    if not job: return False
    data=None
    try:
        data=rt.store.get(job['id'],job['kind'])
        rt.store.get(data['_session'],'session',data['_session'])
        if job['kind']=='message':
            attachments=[rt.store.get(a,'attachment',data['_session']) for a in data['attachment_ids']]
            if any(a['status']=='failed' for a in attachments):
                raise DomainError(422,'attachment_failed','An attachment failed; remove it or upload a readable file')
            previous=[m for m in rt.store.list(data['_session'],'message',200) if m['created_at']<data['created_at'] and m['status'] not in ('completed','failed')]
            if previous or any(a['status']!='ready' for a in attachments):
                if time.time()-data['_queued_at']>180:
                    raise DomainError(504,'processing_timeout','Attachment or prior-message processing exceeded deadline',True)
                data['status']='waiting_for_attachments' if attachments and any(a['status']!='ready' for a in attachments) else 'queued'
                rt.store.finish(job,data,retry=True); return True
        if job['attempts']>=3 and data['status']=='processing':
            raise DomainError(503,'worker_retries_exhausted','Processing repeatedly interrupted; submit a new request',True)
        data['status']='processing'
        with rt.store.transaction() as con: rt.store.update(con,job['id'],data)
        async with asyncio.timeout(90):
            result=await parse_attachment(rt,data) if job['kind']=='attachment' else await answer_message(rt,data)
        rt.store.finish(job,result)
    except asyncio.CancelledError:
        # Leave lease intact; another worker can reclaim after expiry.
        raise
    except Exception as exc:
        error=exc if isinstance(exc,DomainError) else DomainError(503,'processing_failed','Processing failed or timed out; retry with a smaller file or clearer query',True)
        if data:
            data.update(status='failed',error=error.body())
            if job['kind']=='attachment': Path(data['_path']).unlink(missing_ok=True)
        rt.store.finish(job,data)
        logger.warning('job_failed id=%s code=%s',job['id'],error.code)
    return True


async def run():
    logging.basicConfig(level=logging.INFO)
    rt=Runtime(Settings())
    async def slot():
        while True:
            if not await process_one(rt): await asyncio.sleep(0.1)
    async def housekeeping():
        while True:
            rt.store.cleanup()
            (rt.settings.data_dir/'worker.heartbeat').write_text(str(time.time()))
            await asyncio.sleep(10)
    try:
        await asyncio.gather(*(slot() for _ in range(rt.settings.worker_concurrency)),housekeeping())
    finally: await rt.close()


if __name__=='__main__':
    asyncio.run(run())

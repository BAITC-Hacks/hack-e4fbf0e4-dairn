"""Future RAG seam. Current implementation reads approved policy data directly."""
import json
from typing import Protocol


class KnowledgeProvider(Protocol):
    async def lookup(self, query: str, session_id: str) -> list[dict]: ...


class PolicyKnowledge:
    def __init__(self, path):
        # Load once per process; deployments/restarts apply policy changes.
        self.policies = json.loads(path.read_text()) if path else []
        if not isinstance(self.policies,list):
            raise ValueError('Policy file must contain a list')
        for p in self.policies:
            if not all(p.get(k) for k in ('id','text','source','version')):
                raise ValueError('Every policy needs id, text, source and version')

    async def lookup(self, query, session_id):
        terms=('оплат','достав','парт','payment','delivery','minimum')
        return self.policies[:10] if any(t in query.lower() for t in terms) else []

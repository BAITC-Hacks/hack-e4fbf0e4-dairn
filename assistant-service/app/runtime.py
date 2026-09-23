from app.domain.cart.service import CartService
from app.integrations.catalog import Catalog
from app.integrations.knowledge import PolicyKnowledge
from app.integrations.model import AnswerModel
from app.storage.store import Store


class Runtime:
    def __init__(self,settings):
        self.settings=settings
        self.store=Store(settings.data_dir)
        self.catalog=Catalog(settings,self.store)
        self.knowledge=PolicyKnowledge(settings.policy_file)
        self.model=AnswerModel(settings)
        self.cart=CartService(settings,self.store,self.catalog)

    async def close(self):
        await self.catalog.close()
        await self.model.close()

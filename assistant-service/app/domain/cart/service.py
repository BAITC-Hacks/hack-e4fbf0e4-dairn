import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import urlencode

from app.core.errors import DomainError
from app.integrations.catalog import quantity_valid
from app.storage.store import dump, uid


def iso(timestamp):
    return datetime.fromtimestamp(timestamp,timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class CartService:
    def __init__(self, settings, store, catalog):
        self.settings,self.store,self.catalog=settings,store,catalog

    def require_adapter(self):
        if self.settings.cart_mode!='demo' or self.settings.catalog_mode!='demo':
            raise DomainError(503,'cart_not_configured','Partner cart adapter is not configured; no cart was changed')

    def empty(self,sid):
        return {'cart_id':sid,'version':'0','items':[],
                'cart_url':self.settings.frontend_base_url.rstrip('/')+'/cart?'+urlencode({'session_id':sid}),'mode':'demo'}

    def read(self,sid,con=None):
        self.require_adapter()
        try: return self.store.get('cart-'+sid,'cart',sid,con)
        except DomainError as exc:
            if exc.status!=404: raise
            return self.empty(sid)

    async def propose(self,sid,items,session_expiry):
        self.require_adapter()
        availability=await self.catalog.availability(items)
        if not all(i['purchasable'] for i in availability['items']):
            raise DomainError(409,'unavailable_selection','Requested quantities are unavailable or invalid; select again')
        quoted=[]
        for item in items:
            p=await self.catalog.detail(item['product_id'])
            if p.get('price') is None:
                raise DomainError(409,'unknown_price','Current price unavailable')
            quoted.append({'selection':item,'sku':p['sku'],'name':p['name'],'unit':p['unit'],'price':p['price']})
        token=secrets.token_urlsafe(32); id=uid(); expiry=min(time.time()+300,session_expiry)
        proposal={'proposal_id':id,'version':1,'items':quoted,'expires_at':iso(expiry),'status':'pending','_confirmation_hash':digest(token)}
        with self.store.transaction() as con:
            rows=con.execute("SELECT id,data FROM objects WHERE kind='proposal' AND session=?",(sid,)).fetchall()
            for row in rows:
                old=json.loads(row['data'])
                if old['status']=='pending':
                    old['status']='superseded'; self.store.update(con,row['id'],old)
            self.store.put(con,id,'proposal',sid,proposal,expiry)
        return {k:v for k,v in proposal.items() if not k.startswith('_')}|{'confirmation_token':token}

    def confirm(self,sid,pid,body,key,session_expiry):
        self.require_adapter()
        fingerprint=digest(dump({'proposal_id':pid,**body}))
        with self.store.transaction() as con:
            previous=con.execute("SELECT * FROM dedup WHERE session=? AND scope='cart' AND key=?",(sid,key)).fetchone()
            if previous:
                if previous['fingerprint']!=fingerprint:
                    raise DomainError(409,'idempotency_conflict','Key was used for a different confirmation')
                return self.store.get(previous['object_id'],'operation',sid,con)
            proposal=self.store.get(pid,'proposal',sid,con)
            if proposal['status']!='pending' or body['proposal_version']!=proposal['version']:
                raise DomainError(409,'proposal_changed','Proposal already confirmed or superseded; obtain a new proposal')
            if not hmac.compare_digest(proposal['_confirmation_hash'],digest(body['confirmation_token'])):
                raise DomainError(403,'invalid_confirmation','Invalid confirmation token')
            products={p['id']:p for p in self.catalog.demo_products(con)}
            cart=self.read(sid,con)
            for quoted in proposal['items']:
                selection=quoted['selection']; p=products.get(selection['product_id'])
                if not p or p['price']!=quoted['price'] or p['unit']!=quoted['unit']:
                    raise DomainError(409,'price_changed','Price or unit changed; request and confirm a new proposal')
                stock=next((s for s in p['stock'] if s['warehouse_id']==selection['warehouse_id']),None)
                quantity=Decimal(selection['quantity'])
                if not quantity_valid(p,selection) or not stock or Decimal(stock['available_quantity'])<quantity:
                    raise DomainError(409,'stock_changed','Available stock changed; request and confirm a new proposal')
                stock['available_quantity']=format(Decimal(stock['available_quantity'])-quantity,'f')
                p['availability']='in_stock' if any(Decimal(s['available_quantity'])>0 for s in p['stock']) else 'out_of_stock'
                con.execute('UPDATE inventory SET data=? WHERE id=?',(dump(p),p['id']))
                existing=next((q for q in cart['items'] if q['selection']['product_id']==selection['product_id'] and q['selection']['warehouse_id']==selection['warehouse_id']),None)
                if existing:
                    existing['selection']['quantity']=format(Decimal(existing['selection']['quantity'])+quantity,'f')
                    existing['price']=quoted['price']
                else: cart['items'].append(quoted)
            cart['version']=str(int(cart['version'])+1)
            if con.execute('SELECT 1 FROM objects WHERE id=?',('cart-'+sid,)).fetchone():
                self.store.update(con,'cart-'+sid,cart)
            else: self.store.put(con,'cart-'+sid,'cart',sid,cart,session_expiry)
            proposal['status']='confirmed'; self.store.update(con,pid,proposal)
            result={'operation_id':uid(),'proposal_id':pid,'status':'committed','cart':cart}
            self.store.put(con,result['operation_id'],'operation',sid,result,session_expiry)
            con.execute('INSERT INTO dedup VALUES(?,?,?,?,?)',(sid,'cart',key,fingerprint,result['operation_id']))
            return result

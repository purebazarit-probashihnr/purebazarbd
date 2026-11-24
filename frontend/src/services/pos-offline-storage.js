const DATABASE_NAME = 'purebazar-pos-offline';
const DATABASE_VERSION = 1;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('catalogs', { keyPath: 'outletId' });
      database.createObjectStore('queue', { keyPath: 'offlineId' });
      database.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(stores, mode, action) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(stores, mode);
    let result;
    try {
      result = action(tx);
    } catch (error) {
      database.close();
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      database.close();
      resolve(result);
    };
    tx.onerror = () => {
      database.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      database.close();
      reject(tx.error || new Error('Offline storage transaction was aborted.'));
    };
  });
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function savePosCatalog(catalog) {
  await transaction(['catalogs', 'meta'], 'readwrite', (tx) => {
    tx.objectStore('catalogs').put({
      ...catalog,
      outletId: catalog.outlet.id,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function readPosCatalog(outletId) {
  return transaction(['catalogs'], 'readonly', (tx) => (
    requestValue(tx.objectStore('catalogs').get(String(outletId)))
  ));
}

export async function allocateOfflineNumber(outletId, outletCode, range) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['meta'], 'readwrite');
    const store = tx.objectStore('meta');
    const key = `offline-range:${outletId}`;
    let number;
    const getRequest = store.get(key);
    getRequest.onsuccess = () => {
      const current = getRequest.result;
      let next = Number(current?.next);
      let end = Number(current?.end);
      if (!Number.isInteger(next) || !Number.isInteger(end) || next > end) {
        next = Number(range?.start);
        end = Number(range?.end);
      }
      if (!Number.isInteger(next) || !Number.isInteger(end) || next > end) {
        tx.abort();
        return;
      }
      number = `OFF-${outletCode}-${next}`;
      store.put({ key, next: next + 1, end });
    };
    tx.oncomplete = () => {
      database.close();
      resolve(number);
    };
    tx.onerror = () => {
      database.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      database.close();
      reject(tx.error || new Error('No reserved offline bill numbers are available.'));
    };
  });
}

export async function enqueueOfflineBill(bill) {
  await transaction(['catalogs', 'queue', 'meta'], 'readwrite', (tx) => {
    const meta = tx.objectStore('meta');
    const orderKey = `queue-order:${bill.userId}`;
    const orderRequest = meta.get(orderKey);
    orderRequest.onsuccess = () => {
      const queueOrdinal = (Number(orderRequest.result?.value) || 0) + 1;
      meta.put({ key: orderKey, value: queueOrdinal });
      tx.objectStore('queue').add({ ...bill, queueOrdinal });
    };
    const catalogStore = tx.objectStore('catalogs');
    const getRequest = catalogStore.get(bill.outletId);
    getRequest.onsuccess = () => {
      const catalog = getRequest.result;
      if (!catalog) return;
      const deltas = new Map(bill.stockDeductions.map((line) => [line.productId, line.quantity]));
      catalog.items = catalog.items.map((item) => ({
        ...item,
        stock: Number(item.stock || 0) - (deltas.get(String(item.productId)) || 0),
      }));
      catalogStore.put(catalog);
    };
  });
}

export async function listOfflineBills(userId) {
  return transaction(['queue'], 'readonly', (tx) => requestValue(
    tx.objectStore('queue').getAll(),
  )).then((bills) => bills
    .filter((bill) => bill.userId === String(userId))
    .sort((a, b) => a.queueOrdinal - b.queueOrdinal));
}

export async function updateOfflineBill(bill) {
  await transaction(['queue'], 'readwrite', (tx) => {
    tx.objectStore('queue').put(bill);
  });
}

export async function removeOfflineBill(offlineId) {
  await transaction(['queue'], 'readwrite', (tx) => {
    tx.objectStore('queue').delete(offlineId);
  });
}

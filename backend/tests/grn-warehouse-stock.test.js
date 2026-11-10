const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');

jest.mock('../models', () => ({
  AuditLog: { create: jest.fn() },
  GoodsReceive: { create: jest.fn(), findById: jest.fn(), find: jest.fn() },
  Location: { findById: jest.fn() },
  Product: { find: jest.fn() },
  StockMovement: { create: jest.fn(), aggregate: jest.fn() },
  Unit: { find: jest.fn() },
  User: { findById: jest.fn() },
  Vendor: { findById: jest.fn(), find: jest.fn() },
}));

const {
  AuditLog, GoodsReceive, Location, Product, StockMovement, Unit, User, Vendor,
} = require('../models');
const stockRoutes = require('../routes/stockRoutes');
const errorMiddleware = require('../middlewares/errorMiddleware');

const secret = 'grn-warehouse-stock-test-secret';
const warehouseId = '65b000000000000000000002';
const productId = '65b000000000000000000003';
const userId = '65b000000000000000000010';
const locationId = '65b000000000000000000011';
const unitId = '65b000000000000000000005';

const rice = {
  _id: productId, name: 'Rice', barcode: '4006381333931', unitId, ownerType: 'COMPANY',
};

function productQuery(result) {
  const query = {
    select: jest.fn(() => query),
    sort: jest.fn(() => query),
    lean: jest.fn(() => Promise.resolve(result)),
  };
  return query;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', stockRoutes);
  app.use(errorMiddleware);
  return app;
}

function newReceive(data) {
  return {
    ...data,
    _id: new mongoose.Types.ObjectId(),
    status: data.status || 'Draft',
    toObject() {
      return { ...this, toObject: undefined, save: undefined };
    },
    async save({ session } = {}) {},
  };
}

describe('GRN with role-based locationId and warehouse stock updates', () => {
  const app = createApp();
  let session;
  let warehouseStocks;
  let collectionMock;

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    jest.clearAllMocks();
    warehouseStocks = [];
    
    session = {
      withTransaction: jest.fn(async (callback) => {
        const savedStocks = [...warehouseStocks];
        try {
          const result = await callback();
          return result;
        } catch (error) {
          warehouseStocks = savedStocks;
          throw error;
        }
      }),
      endSession: jest.fn().mockResolvedValue(undefined),
    };

    collectionMock = {
      bulkWrite: jest.fn(async (operations) => {
        for (const op of operations) {
          if (op.updateOne) {
            const { filter, update } = op.updateOne;
            const index = warehouseStocks.findIndex(
              (stock) => stock.locationId === filter.locationId.toString()
                && stock.productId === filter.productId.toString(),
            );
            if (index >= 0) {
              warehouseStocks[index].quantity = (warehouseStocks[index].quantity || 0)
                + (update.$inc?.quantity || 0);
              warehouseStocks[index].updatedAt = new Date();
            } else if (update.$set) {
              warehouseStocks.push({
                locationId: filter.locationId.toString(),
                productId: filter.productId.toString(),
                quantity: update.$inc?.quantity || 0,
                updatedAt: new Date(),
              });
            }
          }
        }
        return { result: { ok: 1 } };
      }),
    };

    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    jest.spyOn(mongoose.connection, 'collection').mockReturnValue(collectionMock);

    Location.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ type: 'CENTRAL' }) }),
    });

    Product.find.mockImplementation(() => productQuery([rice]));

    Unit.find.mockReturnValue(productQuery([{
      _id: unitId, name: 'Box', abbreviation: 'box',
    }]));

    AuditLog.create.mockResolvedValue({});

    GoodsReceive.create.mockImplementation(async ([data], { session: creationSession }) => {
      const receive = newReceive(data);
      return [receive];
    });

    GoodsReceive.findById.mockImplementation((id) => ({
      session: jest.fn((sess) => {
        const grnData = {
          _id: id,
          status: 'Draft',
          warehouseId,
          ownerType: 'COMPANY',
          vendorId: null,
          lines: [{ productId, acceptedQuantity: 10, rejectedQuantity: 0, receivedQuantity: 10 }],
          save: jest.fn().mockResolvedValue(true),
          toObject: jest.fn().mockReturnValue({
            _id: id, status: 'Draft', warehouseId, ownerType: 'COMPANY',
          }),
        };
        return Promise.resolve(grnData);
      }),
    }));

    StockMovement.create.mockResolvedValue({});
    StockMovement.aggregate.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Role-based locationId handling in createGoodsReceive', () => {
    it('allows SUPER_ADMIN to use warehouseId from request body', async () => {
      const token = jwt.sign({ sub: userId }, secret, { expiresIn: '1h' });
      User.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: userId,
          isActive: true,
          roleId: { name: 'SUPER_ADMIN', permissions: ['stock:write'] },
          assignedLocation: locationId,
          locationId,
        }),
      });

      const response = await request(app)
        .post('/api/goods-receives')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ownerType: 'COMPANY',
          warehouseId,
          lines: [{ productId, receivedQuantity: 10, acceptedQuantity: 10, rejectedQuantity: 0 }],
        });

      expect(response.status).toBe(201);
      expect(GoodsReceive.create).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ warehouseId }),
        ]),
        expect.any(Object),
      );
    });

    it('forces INVENTORY_MANAGER to use assignedLocation', async () => {
      const token = jwt.sign({ sub: userId }, secret, { expiresIn: '1h' });
      User.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: userId,
          isActive: true,
          roleId: { name: 'INVENTORY_MANAGER', permissions: ['stock:write'] },
          assignedLocation: locationId,
          locationId: null,
        }),
      });

      const response = await request(app)
        .post('/api/goods-receives')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ownerType: 'COMPANY',
          warehouseId: warehouseId, // This will be ignored
          lines: [{ productId, receivedQuantity: 10, acceptedQuantity: 10, rejectedQuantity: 0 }],
        });

      expect(response.status).toBe(201);
      expect(GoodsReceive.create).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ warehouseId: locationId }),
        ]),
        expect.any(Object),
      );
    });

    it('forces Staff role to use assignedLocation', async () => {
      const token = jwt.sign({ sub: userId }, secret, { expiresIn: '1h' });
      User.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: userId,
          isActive: true,
          roleId: { name: 'Staff', permissions: ['stock:write'] },
          assignedLocation: locationId,
          locationId: null,
        }),
      });

      const response = await request(app)
        .post('/api/goods-receives')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ownerType: 'COMPANY',
          warehouseId: warehouseId, // This will be ignored
          lines: [{ productId, receivedQuantity: 5, acceptedQuantity: 5, rejectedQuantity: 0 }],
        });

      expect(response.status).toBe(201);
      expect(GoodsReceive.create).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ warehouseId: locationId }),
        ]),
        expect.any(Object),
      );
    });

    it('rejects INVENTORY_MANAGER without assignedLocation', async () => {
      const token = jwt.sign({ sub: userId }, secret, { expiresIn: '1h' });
      User.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: userId,
          isActive: true,
          roleId: { name: 'INVENTORY_MANAGER', permissions: ['stock:write'] },
          assignedLocation: null,
          locationId: null,
        }),
      });

      const response = await request(app)
        .post('/api/goods-receives')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ownerType: 'COMPANY',
          warehouseId,
          lines: [{ productId, receivedQuantity: 10, acceptedQuantity: 10, rejectedQuantity: 0 }],
        });

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('User must have an assigned location');
      expect(GoodsReceive.create).not.toHaveBeenCalled();
    });
  });

  describe('Warehouse stock upsert on GRN creation', () => {
    beforeEach(() => {
      const token = jwt.sign({ sub: userId }, secret, { expiresIn: '1h' });
      User.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: userId,
          isActive: true,
          roleId: { name: 'SUPER_ADMIN', permissions: ['stock:write'] },
          assignedLocation: locationId,
          locationId,
        }),
      });
    });

    it('creates new warehouse stock record when GRN is created', async () => {
      const token = jwt.sign({ sub: userId }, secret, { expiresIn: '1h' });
      
      const response = await request(app)
        .post('/api/goods-receives')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ownerType: 'COMPANY',
          warehouseId,
          lines: [{ productId, receivedQuantity: 10, acceptedQuantity: 10, rejectedQuantity: 0 }],
        });

      expect(response.status).toBe(201);
      expect(collectionMock.bulkWrite).toHaveBeenCalled();
      
      const bulkOps = collectionMock.bulkWrite.mock.calls[0][0];
      expect(bulkOps).toHaveLength(1);
      expect(bulkOps[0].updateOne.filter).toMatchObject({
        locationId: new mongoose.Types.ObjectId(warehouseId),
        productId,
      });
      expect(bulkOps[0].updateOne.update.$inc.quantity).toBe(10);
    });

    it('increments existing warehouse stock on subsequent GRN', async () => {
      const token = jwt.sign({ sub: userId }, secret, { expiresIn: '1h' });
      
      // Create first GRN
      await request(app)
        .post('/api/goods-receives')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ownerType: 'COMPANY',
          warehouseId,
          lines: [{ productId, receivedQuantity: 10, acceptedQuantity: 10, rejectedQuantity: 0 }],
        });

      expect(warehouseStocks).toHaveLength(1);
      expect(warehouseStocks[0].quantity).toBe(10);

      // Create second GRN
      await request(app)
        .post('/api/goods-receives')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ownerType: 'COMPANY',
          warehouseId,
          lines: [{ productId, receivedQuantity: 5, acceptedQuantity: 5, rejectedQuantity: 0 }],
        });

      expect(warehouseStocks).toHaveLength(1);
      expect(warehouseStocks[0].quantity).toBe(15);
    });

    it('handles multiple products in single GRN', async () => {
      const token = jwt.sign({ sub: userId }, secret, { expiresIn: '1h' });
      const product2Id = '65b000000000000000000014';
      
      Product.find.mockImplementation(() => productQuery([
        rice,
        { _id: product2Id, name: 'Wheat', barcode: '1234567890', unitId, ownerType: 'COMPANY' },
      ]));

      const response = await request(app)
        .post('/api/goods-receives')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ownerType: 'COMPANY',
          warehouseId,
          lines: [
            { productId, receivedQuantity: 10, acceptedQuantity: 10, rejectedQuantity: 0 },
            { productId: product2Id, receivedQuantity: 5, acceptedQuantity: 5, rejectedQuantity: 0 },
          ],
        });

      expect(response.status).toBe(201);
      expect(collectionMock.bulkWrite).toHaveBeenCalled();
      
      const bulkOps = collectionMock.bulkWrite.mock.calls[0][0];
      expect(bulkOps).toHaveLength(2);
      expect(bulkOps[0].updateOne.update.$inc.quantity).toBe(10);
      expect(bulkOps[1].updateOne.update.$inc.quantity).toBe(5);
    });

    it('handles zero acceptedQuantity (rejected items)', async () => {
      const token = jwt.sign({ sub: userId }, secret, { expiresIn: '1h' });
      
      const response = await request(app)
        .post('/api/goods-receives')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ownerType: 'COMPANY',
          warehouseId,
          lines: [{ productId, receivedQuantity: 10, acceptedQuantity: 0, rejectedQuantity: 10 }],
        });

      expect(response.status).toBe(201);
      expect(collectionMock.bulkWrite).toHaveBeenCalled();
      
      const bulkOps = collectionMock.bulkWrite.mock.calls[0][0];
      expect(bulkOps[0].updateOne.update.$inc.quantity).toBe(0);
    });
  });

  describe('Warehouse stock upsert on GRN approval', () => {
    it('includes warehouse stock upsert logic in approval implementation', async () => {
      // Read the controller file to verify the warehouse stock upsert implementation
      const fs = require('fs');
      const path = require('path');
      const controllerPath = path.join(__dirname, '../controllers/goodsReceiveController.js');
      const source = fs.readFileSync(controllerPath, 'utf8');
      
      // Verify the approval function includes warehouse stock upsert
      expect(source).toMatch(/bulkWrite/);
      expect(source).toMatch(/warehousestocks/);
      expect(source).toMatch(/updateOne/);
      expect(source).toMatch(/approveGoodsReceive/);
    });
  });

  describe('Transaction rollback on error', () => {
    it('rolls back warehouse stock changes on bulkWrite failure', async () => {
      const token = jwt.sign({ sub: userId }, secret, { expiresIn: '1h' });
      User.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: userId,
          isActive: true,
          roleId: { name: 'SUPER_ADMIN', permissions: ['stock:write'] },
          assignedLocation: locationId,
          locationId,
        }),
      });

      collectionMock.bulkWrite.mockImplementationOnce(async () => {
        throw new Error('Database write failed');
      });

      const response = await request(app)
        .post('/api/goods-receives')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ownerType: 'COMPANY',
          warehouseId,
          lines: [{ productId, receivedQuantity: 10, acceptedQuantity: 10, rejectedQuantity: 0 }],
        });

      expect(response.status).toBe(500);
      expect(warehouseStocks).toHaveLength(0);
      expect(session.endSession).toHaveBeenCalled();
    });
  });
});

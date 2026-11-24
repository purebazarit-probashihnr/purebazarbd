'use client';

import { useCallback, useRef, useState } from 'react';
import {
  STOCK_LIMIT_MESSAGE, availableStock, canSellPieces, clampQuantity,
} from '@/services/pos-cart-utils.cjs';
import { isGram, productLabel } from '@/services/stock-units.cjs';

export default function usePosCart({ online, catalog, catalogError, showToast }) {
  const [items, setItems] = useState([]);
  const [billDiscount, setBillDiscount] = useState(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const addItem = useCallback((product) => {
    const snapshot = catalog?.items?.find((item) => String(item.productId) === String(product.productId));
    const itemData = { ...snapshot, ...product };
    const stock = Number(itemData.stock) || 0;
    const existing = itemsRef.current.find((item) => item.productId === String(itemData.productId));
    const limit = existing ? availableStock({ ...existing, stock }) : Math.floor(stock);
    if (!online && !catalog) {
      showToast(catalogError || 'The outlet catalog is not cached for offline use.');
      return;
    }
    if (online && (limit < 1 || (existing && Number(existing.quantity) >= limit))) {
      showToast(STOCK_LIMIT_MESSAGE);
      if (limit < 1 && !existing) return;
    }
    setItems((current) => {
      const found = current.find((item) => item.productId === String(itemData.productId));
      if (found) {
        if (online && Number(found.quantity) >= availableStock({ ...found, stock })) return current;
        return current.map((item) => item.productId === found.productId
          ? { ...item, stock, quantity: Number(item.quantity) + 1 }
          : item);
      }
      if (online && limit < 1) return current;
      return [...current, {
        productId: String(itemData.productId),
        name: productLabel(itemData),
        barcode: itemData.barcode,
        mrp: Number(itemData.mrp),
        unitValue: itemData.unitValue,
        unitsPerPackage: itemData.unitsPerPackage,
        packageUnitName: itemData.packageUnitName,
        subUnitPrice: itemData.subUnitPrice,
        ownerType: itemData.ownerType,
        vendorId: itemData.vendorId,
        vendorName: itemData.vendorName,
        vendorPrice: Number(itemData.vendorPrice),
        vatApplicable: itemData.vatApplicable,
        vatRate: itemData.vatRate,
        categoryVatRate: itemData.categoryVatRate,
        vendorMatches: product.vendorMatches || itemData.vendorMatches || [],
        unit: 'PACKAGE',
        stock,
        quantity: isGram(product.packageUnitName) ? Math.max(1, Math.min(1000, Math.floor(stock))) : 1,
      }];
    });
  }, [catalog, catalogError, online, showToast]);

  function changeVendor(productId, candidate) {
    const itemData = {
      ...catalog?.items?.find((item) => String(item.productId) === String(candidate.productId)),
      ...candidate,
    };
    setItems((current) => current.map((item) => {
      if (item.productId !== productId) return item;
      const stock = Number(itemData.stock) || 0;
      return {
        ...item,
        productId: String(itemData.productId),
        name: productLabel(itemData),
        barcode: itemData.barcode,
        mrp: Number(itemData.mrp),
        unitValue: itemData.unitValue,
        unitsPerPackage: itemData.unitsPerPackage,
        packageUnitName: itemData.packageUnitName,
        subUnitPrice: itemData.subUnitPrice,
        ownerType: itemData.ownerType,
        vendorId: itemData.vendorId,
        vendorName: itemData.vendorName,
        vendorPrice: Number(itemData.vendorPrice),
        vatApplicable: itemData.vatApplicable,
        vatRate: itemData.vatRate,
        categoryVatRate: itemData.categoryVatRate,
        stock,
        quantity: online ? Math.max(1, Math.min(Number(item.quantity), stock)) : item.quantity,
        vendorMatches: item.vendorMatches,
      };
    }));
  }

  function updateQuantity(productId, value) {
    const target = items.find((item) => item.productId === productId);
    if (!target) return;
    const { quantity, limited } = online
      ? clampQuantity(value, availableStock(target))
      : { quantity: Number(value), limited: false };
    if (!Number.isFinite(quantity) || quantity <= 0 || (target.unit === 'PIECE' && !Number.isInteger(quantity))) return;
    if (limited) showToast(STOCK_LIMIT_MESSAGE);
    setItems((current) => current.map((item) => item.productId === productId
      ? { ...item, quantity: Math.max(quantity, 1) }
      : item));
  }

  function updateUnit(productId, unit) {
    setItems((current) => current.map((item) => item.productId === productId && canSellPieces(item)
      ? { ...item, unit, quantity: 1 }
      : item));
  }

  function updateItemDiscount(productId, patch) {
    setItems((current) => current.map((item) => item.productId === productId
      ? { ...item, discount: { type: 'PERCENT', ...item.discount, ...patch } }
      : item));
  }

  function updateBillDiscount(patch) {
    setBillDiscount((current) => ({ type: 'PERCENT', ...current, ...patch }));
  }

  return {
    items, setItems, billDiscount, setBillDiscount, addItem, changeVendor,
    updateQuantity, updateUnit, updateItemDiscount, updateBillDiscount,
  };
}

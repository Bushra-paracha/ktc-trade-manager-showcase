import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchAll } from '../lib/fetchAll';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PIPELINE_STAGES = ['New', 'Contacted', 'Engaged', 'Negotiating', 'Won', 'Lost', 'Dormant'];
const ORDER_STAGES = ['Inquiry', 'Quotation', 'Negotiation', 'Confirmed', 'Production', 'Ready to Ship', 'Shipped', 'Delivered'];

function money(value) {
  return Number(value) || 0;
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const diff = (new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24);
  return Number.isFinite(diff) && diff >= 0 ? diff : null;
}

function readProductsFromClient(client) {
  const raw = client.products_interest || client.productsInterest || [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function readOrderItems(order) {
  if (Array.isArray(order.order_items) && order.order_items.length > 0) return order.order_items;
  return [];
}

function getOrderValue(order) {
  return money(order.total_value ?? order.value ?? order.revenue);
}

export function useAnalytics() {
  const [data, setData] = useState({
    monthlyRevenue: [],
    revenueByCountry: [],
    pipelineByStage: [],
    orderWorkflow: [],
    leadToInquiryRate: 0,
    inquiryToOrderRate: 0,
    avgSalesCycleDays: 0,
    totalRevenue: 0,
    projectedPipelineValue: 0,
    totalBuyers: 0,
    activeBuyers: 0,
    totalOrders: 0,
    totalInquiries: 0,
    activeCountries: 0,
    averageOrderValue: 0,
    topMarkets: [],
    topProducts: [],
    productInterest: [],
    priorityMarkets: [],
    reportHighlights: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      const [clientsRes, inquiriesRes, ordersRes] = await Promise.all([
        fetchAll(() => supabase.from('clients').select('*').order('id')),
        supabase.from('inquiries').select('*, clients(country, company)'),
        supabase.from('orders').select('*, clients(country, company), order_items(*)'),
      ]);

      if (!active) return;

      if (clientsRes.error || inquiriesRes.error || ordersRes.error) {
        setError(clientsRes.error?.message || inquiriesRes.error?.message || ordersRes.error?.message);
        setLoading(false);
        return;
      }

      const clients = clientsRes.data || [];
      const inquiries = inquiriesRes.data || [];
      const orders = ordersRes.data || [];

      const now = new Date();
      const months = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({ year: d.getFullYear(), month: d.getMonth(), label: MONTH_NAMES[d.getMonth()] });
      }

      const monthlyRevenue = months.map(({ year, month, label }) => {
        const revenue = orders
          .filter((order) => {
            const d = new Date(order.created_at);
            return d.getFullYear() === year && d.getMonth() === month;
          })
          .reduce((sum, order) => sum + getOrderValue(order), 0);
        return { month: label, revenue, target: 0 };
      });

      const nonZeroMonths = monthlyRevenue.filter((item) => item.revenue > 0).map((item) => item.revenue);
      const avgRevenue = nonZeroMonths.length ? nonZeroMonths.reduce((a, b) => a + b, 0) / nonZeroMonths.length : 0;
      monthlyRevenue.forEach((item) => { item.target = Math.round(avgRevenue); });

      const totalRevenue = orders.reduce((sum, order) => sum + getOrderValue(order), 0);
      const averageOrderValue = orders.length ? Math.round(totalRevenue / orders.length) : 0;
      const totalBuyers = clients.length;
      const totalOrders = orders.length;
      const totalInquiries = inquiries.length;
      const activeBuyers = clients.filter((client) => ['Contacted', 'Engaged', 'Negotiating', 'Won'].includes(client.status)).length;
      const activeCountries = new Set(clients.map((client) => client.country).filter(Boolean)).size;

      const projectedPipelineValue = clients
        .filter((client) => !['Won', 'Lost', 'Dormant'].includes(client.status))
        .reduce((sum, client) => sum + money(client.revenue), 0);

      const countryTotals = {};
      orders.forEach((order) => {
        const country = order.clients?.country || order.country || 'Unknown';
        countryTotals[country] = countryTotals[country] || { country, revenue: 0, orders: 0, buyers: 0 };
        countryTotals[country].revenue += getOrderValue(order);
        countryTotals[country].orders += 1;
      });
      clients.forEach((client) => {
        const country = client.country || 'Unknown';
        countryTotals[country] = countryTotals[country] || { country, revenue: 0, orders: 0, buyers: 0 };
        countryTotals[country].buyers += 1;
      });
      const revenueByCountry = Object.values(countryTotals)
        .map((item) => ({ ...item, value: item.revenue }))
        .sort((a, b) => b.revenue - a.revenue || b.buyers - a.buyers);
      const topMarkets = revenueByCountry.slice(0, 6);

      const pipelineByStage = PIPELINE_STAGES.map((stage) => {
        const stageClients = clients.filter((client) => client.status === stage);
        return {
          stage,
          count: stageClients.length,
          value: stageClients.reduce((sum, client) => sum + money(client.revenue), 0),
          avgScore: stageClients.length
            ? Math.round(stageClients.reduce((sum, client) => sum + (Number(client.score) || 0), 0) / stageClients.length)
            : 0,
        };
      }).filter((item) => item.count > 0);

      const orderWorkflow = ORDER_STAGES.map((stage) => {
        const matching = orders.filter((order) => order.status === stage);
        return {
          stage,
          count: matching.length,
          value: matching.reduce((sum, order) => sum + getOrderValue(order), 0),
        };
      }).filter((item) => item.count > 0);

      const productMap = {};
      orders.forEach((order) => {
        readOrderItems(order).forEach((item) => {
          const product = item.product_name || item.name || item.product_id || 'Unknown Product';
          productMap[product] = productMap[product] || { product, revenue: 0, quantity: 0, orders: 0 };
          productMap[product].revenue += money(item.line_total) || money(item.quantity_mt) * money(item.unit_price);
          productMap[product].quantity += money(item.quantity_mt);
          productMap[product].orders += 1;
        });
      });
      const topProducts = Object.values(productMap)
        .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
        .slice(0, 8);

      const interestMap = {};
      clients.forEach((client) => {
        readProductsFromClient(client).forEach((product) => {
          interestMap[product] = interestMap[product] || { product, buyers: 0, score: 0 };
          interestMap[product].buyers += 1;
          interestMap[product].score += Number(client.score) || 0;
        });
      });
      const productInterest = Object.values(interestMap)
        .map((item) => ({ ...item, avgScore: item.buyers ? Math.round(item.score / item.buyers) : 0 }))
        .sort((a, b) => b.buyers - a.buyers || b.avgScore - a.avgScore)
        .slice(0, 8);

      const leadToInquiryRate = totalBuyers ? Math.round((totalInquiries / totalBuyers) * 1000) / 10 : 0;
      const inquiryToOrderRate = totalInquiries ? Math.round((totalOrders / totalInquiries) * 1000) / 10 : 0;

      const cycleDays = orders
        .map((order) => {
          if (!order.inquiry_id) return null;
          const inquiry = inquiries.find((item) => item.id === order.inquiry_id);
          return inquiry ? daysBetween(inquiry.created_at, order.created_at) : null;
        })
        .filter((item) => item !== null);
      const avgSalesCycleDays = cycleDays.length
        ? Math.round(cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length)
        : 0;

      const priorityMarkets = Object.values(countryTotals)
        .map((market) => ({
          ...market,
          opportunityScore: market.buyers * 8 + market.orders * 12 + Math.round(market.revenue / 10000),
        }))
        .sort((a, b) => b.opportunityScore - a.opportunityScore)
        .slice(0, 5);

      const reportHighlights = [
        totalRevenue > 0 ? `Confirmed revenue tracked: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalRevenue)}.` : 'No confirmed revenue has been logged yet.',
        totalBuyers > 0 ? `${activeBuyers} of ${totalBuyers} buyers are active, engaged, negotiating, or won.` : 'Buyer records will appear here once added.',
        topMarkets[0] ? `${topMarkets[0].country} is currently the strongest market by revenue/buyer activity.` : 'Top market insights will appear after buyers or orders are added.',
        productInterest[0] ? `${productInterest[0].product} has the highest buyer interest in the CRM.` : 'Product interest insights will appear after buyer product interests are recorded.',
      ];

      setData({
        monthlyRevenue,
        revenueByCountry,
        pipelineByStage,
        orderWorkflow,
        leadToInquiryRate,
        inquiryToOrderRate,
        avgSalesCycleDays,
        totalRevenue,
        projectedPipelineValue,
        totalBuyers,
        activeBuyers,
        totalOrders,
        totalInquiries,
        activeCountries,
        averageOrderValue,
        topMarkets,
        topProducts,
        productInterest,
        priorityMarkets,
        reportHighlights,
      });
      setLoading(false);
    }

    load();
    return () => { active = false; };
  }, []);

  return { ...data, loading, error };
}

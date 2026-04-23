// Static geo reference data only. Everything else in this file used to be
// Math.random() fixtures that leaked onto real user accounts — all removed.
// Every dashboard now derives its numbers from live Tally customers (see
// extendedEngine.js + analyticsEngine.js), or renders an empty state when
// no live snapshot exists.

export const INDIA_STATES = [
  { state: 'Maharashtra', code: 'MH', x: 280, y: 380, cities: ['Mumbai', 'Pune', 'Nagpur'] },
  { state: 'Delhi', code: 'DL', x: 310, y: 180, cities: ['New Delhi'] },
  { state: 'Karnataka', code: 'KA', x: 270, y: 470, cities: ['Bangalore', 'Mysore'] },
  { state: 'Tamil Nadu', code: 'TN', x: 300, y: 540, cities: ['Chennai', 'Coimbatore'] },
  { state: 'Gujarat', code: 'GJ', x: 215, y: 310, cities: ['Ahmedabad', 'Surat'] },
  { state: 'Rajasthan', code: 'RJ', x: 240, y: 230, cities: ['Jaipur', 'Udaipur'] },
  { state: 'Uttar Pradesh', code: 'UP', x: 360, y: 220, cities: ['Lucknow', 'Varanasi', 'Noida'] },
  { state: 'West Bengal', code: 'WB', x: 460, y: 310, cities: ['Kolkata'] },
  { state: 'Telangana', code: 'TS', x: 310, y: 420, cities: ['Hyderabad'] },
  { state: 'Kerala', code: 'KL', x: 265, y: 560, cities: ['Kochi', 'Trivandrum'] },
  { state: 'Madhya Pradesh', code: 'MP', x: 320, y: 300, cities: ['Bhopal', 'Indore'] },
  { state: 'Punjab', code: 'PB', x: 275, y: 155, cities: ['Chandigarh', 'Ludhiana'] },
  { state: 'Bihar', code: 'BR', x: 430, y: 260, cities: ['Patna'] },
  { state: 'Odisha', code: 'OD', x: 410, y: 370, cities: ['Bhubaneswar'] },
  { state: 'Assam', code: 'AS', x: 530, y: 230, cities: ['Guwahati'] },
  { state: 'Jharkhand', code: 'JH', x: 420, y: 300, cities: ['Ranchi'] },
  { state: 'Haryana', code: 'HR', x: 290, y: 175, cities: ['Gurugram'] },
  { state: 'Chhattisgarh', code: 'CG', x: 370, y: 340, cities: ['Raipur'] },
];

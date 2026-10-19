/**
 * Every Indian state and union territory with its main cities, for the
 * searchable State → City pickers. A navigation shortcut only: picking a city
 * centres the map there, and the user then sets the exact point. Coordinates
 * are city centres, accurate enough to frame a map, never used as a task or
 * worker location on their own. Not the server's `cities` table, which is a
 * short list of service-area labels.
 */

export interface IndianCity {
  name: string;
  lat: number;
  lng: number;
}

export interface IndianState {
  name: string;
  cities: readonly IndianCity[];
}

const c = (name: string, lat: number, lng: number): IndianCity => ({ name, lat, lng });

export const INDIA_STATES: readonly IndianState[] = [
  { name: 'Andaman and Nicobar Islands', cities: [c('Port Blair', 11.6234, 92.7265)] },
  {
    name: 'Andhra Pradesh',
    cities: [
      c('Visakhapatnam', 17.6868, 83.2185), c('Vijayawada', 16.5062, 80.648), c('Guntur', 16.3067, 80.4365),
      c('Nellore', 14.4426, 79.9865), c('Kurnool', 15.8281, 78.0373), c('Tirupati', 13.6288, 79.4192),
      c('Kakinada', 16.9891, 82.2475), c('Amaravati', 16.5131, 80.5165),
    ],
  },
  {
    name: 'Arunachal Pradesh',
    cities: [c('Itanagar', 27.0844, 93.6053), c('Naharlagun', 27.1047, 93.6952), c('Pasighat', 28.066, 95.326), c('Tawang', 27.586, 91.859)],
  },
  {
    name: 'Assam',
    cities: [
      c('Guwahati', 26.1445, 91.7362), c('Dibrugarh', 27.4728, 94.912), c('Silchar', 24.8333, 92.7789),
      c('Jorhat', 26.7509, 94.2037), c('Tezpur', 26.6338, 92.8), c('Nagaon', 26.348, 92.6838),
    ],
  },
  {
    name: 'Bihar',
    cities: [
      c('Patna', 25.5941, 85.1376), c('Gaya', 24.7914, 85.0002), c('Bhagalpur', 25.2425, 86.9842),
      c('Muzaffarpur', 26.1209, 85.3647), c('Darbhanga', 26.1542, 85.8918), c('Purnia', 25.7771, 87.4753),
    ],
  },
  { name: 'Chandigarh', cities: [c('Chandigarh', 30.7333, 76.7794)] },
  {
    name: 'Chhattisgarh',
    cities: [
      c('Raipur', 21.2514, 81.6296), c('Bhilai', 21.1938, 81.3509), c('Bilaspur', 22.0797, 82.1409),
      c('Korba', 22.3595, 82.7501), c('Durg', 21.1904, 81.2849),
    ],
  },
  {
    name: 'Dadra and Nagar Haveli and Daman and Diu',
    cities: [c('Daman', 20.3974, 72.8328), c('Silvassa', 20.2766, 73.0169), c('Diu', 20.7144, 70.9874)],
  },
  {
    name: 'Delhi',
    cities: [
      c('New Delhi', 28.6139, 77.209), c('Dwarka', 28.5921, 77.046), c('Rohini', 28.7495, 77.0565),
      c('Saket', 28.5245, 77.2066), c('Laxmi Nagar', 28.6304, 77.2773), c('Karol Bagh', 28.6519, 77.1909),
    ],
  },
  {
    name: 'Goa',
    cities: [c('Panaji', 15.4909, 73.8278), c('Margao', 15.2832, 73.9862), c('Vasco da Gama', 15.3982, 73.8113), c('Mapusa', 15.5915, 73.8089)],
  },
  {
    name: 'Gujarat',
    cities: [
      c('Ahmedabad', 23.0225, 72.5714), c('Surat', 21.1702, 72.8311), c('Vadodara', 22.3072, 73.1812),
      c('Rajkot', 22.3039, 70.8022), c('Gandhinagar', 23.2156, 72.6369), c('Bhavnagar', 21.7645, 72.1519),
      c('Jamnagar', 22.4707, 70.0577), c('Junagadh', 21.5222, 70.4579), c('Anand', 22.5645, 72.9289),
    ],
  },
  {
    name: 'Haryana',
    cities: [
      c('Gurugram', 28.4595, 77.0266), c('Faridabad', 28.4089, 77.3178), c('Panipat', 29.3909, 76.9635),
      c('Ambala', 30.3782, 76.7767), c('Karnal', 29.6857, 76.9905), c('Hisar', 29.1492, 75.7217),
      c('Rohtak', 28.8955, 76.6066), c('Sonipat', 28.9931, 77.0151),
    ],
  },
  {
    name: 'Himachal Pradesh',
    cities: [
      c('Shimla', 31.1048, 77.1734), c('Dharamshala', 32.219, 76.3234), c('Manali', 32.2432, 77.1892),
      c('Mandi', 31.7087, 76.932), c('Solan', 30.9045, 77.0967), c('Kullu', 31.9578, 77.1095),
    ],
  },
  {
    name: 'Jammu and Kashmir',
    cities: [
      c('Srinagar', 34.0837, 74.7973), c('Jammu', 32.7266, 74.857), c('Anantnag', 33.7311, 75.1487),
      c('Baramulla', 34.198, 74.3636), c('Udhampur', 32.916, 75.1416),
    ],
  },
  {
    name: 'Jharkhand',
    cities: [
      c('Ranchi', 23.3441, 85.3096), c('Jamshedpur', 22.8046, 86.2029), c('Dhanbad', 23.7957, 86.4304),
      c('Bokaro Steel City', 23.6693, 86.1511), c('Deoghar', 24.4826, 86.6955), c('Hazaribagh', 23.9925, 85.3637),
    ],
  },
  {
    name: 'Karnataka',
    cities: [
      c('Bengaluru', 12.9716, 77.5946), c('Mysuru', 12.2958, 76.6394), c('Mangaluru', 12.9141, 74.856),
      c('Hubballi', 15.3647, 75.124), c('Belagavi', 15.8497, 74.4977), c('Kalaburagi', 17.3297, 76.8343),
      c('Davanagere', 14.4644, 75.9218), c('Udupi', 13.3409, 74.7421),
    ],
  },
  {
    name: 'Kerala',
    cities: [
      c('Thiruvananthapuram', 8.5241, 76.9366), c('Kochi', 9.9312, 76.2673), c('Kozhikode', 11.2588, 75.7804),
      c('Thrissur', 10.5276, 76.2144), c('Kollam', 8.8932, 76.6141), c('Kannur', 11.8745, 75.3704),
      c('Alappuzha', 9.4981, 76.3388), c('Kottayam', 9.5916, 76.5222),
    ],
  },
  { name: 'Ladakh', cities: [c('Leh', 34.1526, 77.5771), c('Kargil', 34.5539, 76.1349)] },
  { name: 'Lakshadweep', cities: [c('Kavaratti', 10.5669, 72.642)] },
  {
    name: 'Madhya Pradesh',
    cities: [
      c('Bhopal', 23.2599, 77.4126), c('Indore', 22.7196, 75.8577), c('Jabalpur', 23.1815, 79.9864),
      c('Gwalior', 26.2183, 78.1828), c('Ujjain', 23.1765, 75.7885), c('Sagar', 23.8388, 78.7378),
      c('Rewa', 24.5373, 81.3042), c('Satna', 24.6005, 80.8322),
    ],
  },
  {
    name: 'Maharashtra',
    cities: [
      c('Mumbai', 19.076, 72.8777), c('Pune', 18.5204, 73.8567), c('Nagpur', 21.1458, 79.0882),
      c('Nashik', 19.9975, 73.7898), c('Thane', 19.2183, 72.9781), c('Navi Mumbai', 19.033, 73.0297),
      c('Chhatrapati Sambhajinagar', 19.8762, 75.3433), c('Solapur', 17.6599, 75.9064), c('Kolhapur', 16.705, 74.2433),
      c('Amravati', 20.9374, 77.7796),
    ],
  },
  { name: 'Manipur', cities: [c('Imphal', 24.817, 93.9368), c('Thoubal', 24.634, 93.9856), c('Churachandpur', 24.3333, 93.6833)] },
  { name: 'Meghalaya', cities: [c('Shillong', 25.5788, 91.8933), c('Tura', 25.5138, 90.2034), c('Jowai', 25.4517, 92.2089)] },
  { name: 'Mizoram', cities: [c('Aizawl', 23.7271, 92.7176), c('Lunglei', 22.884, 92.734)] },
  { name: 'Nagaland', cities: [c('Kohima', 25.6751, 94.1086), c('Dimapur', 25.9091, 93.7266), c('Mokokchung', 26.322, 94.514)] },
  {
    name: 'Odisha',
    cities: [
      c('Bhubaneswar', 20.2961, 85.8245), c('Cuttack', 20.4625, 85.883), c('Rourkela', 22.2604, 84.8536),
      c('Berhampur', 19.315, 84.7941), c('Sambalpur', 21.4669, 83.9812), c('Puri', 19.8135, 85.8312),
      c('Balasore', 21.4934, 86.9135),
    ],
  },
  { name: 'Puducherry', cities: [c('Puducherry', 11.9416, 79.8083), c('Karaikal', 10.9254, 79.838)] },
  {
    name: 'Punjab',
    cities: [
      c('Ludhiana', 30.901, 75.8573), c('Amritsar', 31.634, 74.8723), c('Jalandhar', 31.326, 75.5762),
      c('Patiala', 30.3398, 76.3869), c('Bathinda', 30.211, 74.9455), c('Mohali', 30.7046, 76.7179),
    ],
  },
  {
    name: 'Rajasthan',
    cities: [
      c('Jaipur', 26.9124, 75.7873), c('Jodhpur', 26.2389, 73.0243), c('Udaipur', 24.5854, 73.7125),
      c('Kota', 25.2138, 75.8648), c('Ajmer', 26.4499, 74.6399), c('Bikaner', 28.0229, 73.3119),
      c('Alwar', 27.553, 76.6346), c('Bhilwara', 25.3407, 74.6313),
    ],
  },
  { name: 'Sikkim', cities: [c('Gangtok', 27.3389, 88.6065), c('Namchi', 27.1667, 88.35)] },
  {
    name: 'Tamil Nadu',
    cities: [
      c('Chennai', 13.0827, 80.2707), c('Coimbatore', 11.0168, 76.9558), c('Madurai', 9.9252, 78.1198),
      c('Tiruchirappalli', 10.7905, 78.7047), c('Salem', 11.6643, 78.146), c('Tirunelveli', 8.7139, 77.7567),
      c('Vellore', 12.9165, 79.1325), c('Erode', 11.341, 77.7172), c('Thoothukudi', 8.7642, 78.1348),
    ],
  },
  {
    name: 'Telangana',
    cities: [
      c('Hyderabad', 17.385, 78.4867), c('Secunderabad', 17.4399, 78.4983), c('Warangal', 17.9689, 79.5941),
      c('Nizamabad', 18.6725, 78.0941), c('Karimnagar', 18.4386, 79.1288), c('Khammam', 17.2473, 80.1514),
    ],
  },
  { name: 'Tripura', cities: [c('Agartala', 23.8315, 91.2868), c('Udaipur', 23.5333, 91.4833), c('Dharmanagar', 24.3667, 92.1667)] },
  {
    name: 'Uttar Pradesh',
    cities: [
      c('Lucknow', 26.8467, 80.9462), c('Kanpur', 26.4499, 80.3319), c('Noida', 28.5355, 77.391),
      c('Ghaziabad', 28.6692, 77.4538), c('Agra', 27.1767, 78.0081), c('Varanasi', 25.3176, 82.9739),
      c('Prayagraj', 25.4358, 81.8463), c('Meerut', 28.9845, 77.7064), c('Bareilly', 28.367, 79.4304),
      c('Aligarh', 27.8974, 78.088), c('Gorakhpur', 26.7606, 83.3732), c('Mathura', 27.4924, 77.6737),
    ],
  },
  {
    name: 'Uttarakhand',
    cities: [
      c('Dehradun', 30.3165, 78.0322), c('Haridwar', 29.9457, 78.1642), c('Rishikesh', 30.0869, 78.2676),
      c('Haldwani', 29.2183, 79.513), c('Roorkee', 29.8543, 77.888), c('Nainital', 29.3803, 79.4636),
    ],
  },
  {
    name: 'West Bengal',
    cities: [
      c('Kolkata', 22.5726, 88.3639), c('Howrah', 22.5958, 88.2636), c('Durgapur', 23.5204, 87.3119),
      c('Asansol', 23.6739, 86.9524), c('Siliguri', 26.7271, 88.3953), c('Bardhaman', 23.2324, 87.8615),
      c('Kharagpur', 22.346, 87.232), c('Darjeeling', 27.041, 88.2663),
    ],
  },
];

/** Centre of India, for a map with nothing chosen yet. */
export const INDIA_CENTRE = { lat: 22.9734, lng: 78.6569 };

/**
 * The listed city closest to a point, by a flat-earth approximation that is
 * fine for picking a display label ("near Ahmedabad"). A label only: it never
 * decides anything about eligibility or distance, which the server measures.
 */
export function nearestListedCity(lat: number, lng: number): { city: IndianCity; state: string } | null {
  let best: { city: IndianCity; state: string; score: number } | null = null;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const state of INDIA_STATES) {
    for (const city of state.cities) {
      const dLat = city.lat - lat;
      const dLng = (city.lng - lng) * cosLat;
      const score = dLat * dLat + dLng * dLng;
      if (!best || score < best.score) best = { city, state: state.name, score };
    }
  }
  return best ? { city: best.city, state: best.state } : null;
}

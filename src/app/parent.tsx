import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../supabase';

export default function ParentDashboard() {
  const [children, setChildren] = useState([]);
  const [distance, setDistance] = useState(500); // Start 500 meters away
  const [isCheckedIn, setIsCheckedIn] = useState(false);

  // The Geofence Logic: Must be within 50 meters to check in
  const isCloseEnough = distance <= 50;

  useEffect(() => {
    // Fetch only this specific parent's children (parent_001 = Ayesha's parent)
    fetchMyChildren();
  }, []);

  const fetchMyChildren = async () => {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('parent_id', 'parent_001'); // Hardcoded for MVP Demo
      
    if (error) console.error("Error fetching data:", error);
    else setChildren(data);
  };

  const handleCheckIn = async () => {
    if (!isCloseEnough) return;
    
    // Update the database to trigger the classroom board!
    const { error } = await supabase
      .from('students')
      .update({ status: 'dispatched' })
      .eq('parent_id', 'parent_001');

    if (error) {
      console.error("Error checking in:", error);
    } else {
      setIsCheckedIn(true);
      fetchMyChildren(); // Refresh local screen
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>SafePass Parent</Text>

      {/* GEOFENCE DEMO SIMULATOR */}
      <View style={styles.simulatorBox}>
        <Text style={styles.simulatorText}>DEMO: Distance to School Gate</Text>
        <Text style={styles.distanceText}>{distance} meters</Text>
        
        {/* Fake Slider buttons since standard React Native Web lacks a native slider */}
        <View style={styles.sliderControls}>
          <TouchableOpacity style={styles.simBtn} onPress={() => setDistance(500)}><Text style={styles.simBtnText}>500m</Text></TouchableOpacity>
          <TouchableOpacity style={styles.simBtn} onPress={() => setDistance(100)}><Text style={styles.simBtnText}>100m</Text></TouchableOpacity>
          <TouchableOpacity style={styles.simBtn} onPress={() => setDistance(45)}><Text style={styles.simBtnText}>45m (In Range)</Text></TouchableOpacity>
        </View>
      </View>

      {/* THE MAIN CHECK-IN BUTTON */}
      <View style={styles.card}>
        <View style={styles.locationHeader}>
          <Text style={styles.locationText}>
            {isCloseEnough ? "📍 Gate A — Detected" : "📍 Too far from school"}
          </Text>
        </View>

        <TouchableOpacity 
          style={[
            styles.checkInButton, 
            !isCloseEnough ? styles.buttonDisabled : null,
            isCheckedIn ? styles.buttonSuccess : null
          ]}
          onPress={handleCheckIn}
          disabled={!isCloseEnough || isCheckedIn}
        >
          <Text style={styles.buttonText}>
            {isCheckedIn ? "✅ DISPATCHED" : (isCloseEnough ? "📱 TAP TO CHECK IN" : "APPROACH GATE TO UNLOCK")}
          </Text>
        </TouchableOpacity>
      </View>

      {/* CHILDREN STATUS */}
      <Text style={styles.subHeader}>YOUR CHILDREN</Text>
      {children.map((child: any) => (
        <View key={child.id} style={styles.childRow}>
          <Text style={styles.childName}>{child.name}</Text>
          <Text style={[styles.childStatus, child.status === 'dispatched' ? styles.textGreen : styles.textYellow]}>
            {child.status.toUpperCase()}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A2540', padding: 20 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 20 },
  
  simulatorBox: { backgroundColor: '#1E3E66', padding: 15, borderRadius: 8, marginBottom: 30, borderWidth: 1, borderColor: '#FCD34D' },
  simulatorText: { color: '#8A9DB5', fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase' },
  distanceText: { color: '#FFFFFF', fontSize: 24, fontWeight: 'bold', marginVertical: 10 },
  sliderControls: { flexDirection: 'row', gap: 10 },
  simBtn: { backgroundColor: '#112B4A', padding: 10, borderRadius: 6, flex: 1, alignItems: 'center' },
  simBtnText: { color: '#FFFFFF', fontSize: 12 },

  card: { backgroundColor: '#112B4A', padding: 20, borderRadius: 12, marginBottom: 30, borderWidth: 1, borderColor: '#1E3E66' },
  locationHeader: { marginBottom: 20 },
  locationText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  
  checkInButton: { backgroundColor: '#20C20E', padding: 20, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#2A3B4C' },
  buttonSuccess: { backgroundColor: '#103D1A', borderColor: '#20C20E', borderWidth: 1 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },

  subHeader: { color: '#8A9DB5', fontSize: 12, fontWeight: 'bold', marginBottom: 10 },
  childRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#112B4A', padding: 15, borderRadius: 8, marginBottom: 10 },
  childName: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  childStatus: { fontWeight: 'bold', fontSize: 12 },
  textYellow: { color: '#FCD34D' },
  textGreen: { color: '#20C20E' },
});


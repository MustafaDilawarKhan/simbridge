// R0 spike sample app: one screen built so a script can measure tap lag.
//
// Every element sits at a fixed position, given as a share of the screen, so
// the `measure` tool knows where to tap and which pixels to watch:
//   - animated bar:   y 12% to 16%  (moves only while "Animate" is on)
//   - counter button: y 45% to 65%, x 10% to 90%  (tap target, changes colour)
//   - last tap text:  y 68% to 74%
//   - Animate button: y 80% to 90%, x 10% to 90%
// Keep these numbers in sync with spikes/r0/lib/layout.mjs.
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

function clockTime(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export default function App() {
  const [count, setCount] = useState(0);
  const [lastTap, setLastTap] = useState('never');
  const [animate, setAnimate] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) {
      progress.stopAnimation();
      progress.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, progress]);

  // onPressIn, not onPress: the screen changes when the finger goes down, so
  // the measured lag is "touch begins" to "pixels change".
  const onCounterPressIn = () => {
    const next = count + 1;
    setCount(next);
    setLastTap(clockTime(new Date()));
    console.log(`[r0] tap ${next}`);
  };

  const onAnimatePressIn = () => {
    setAnimate((on) => {
      console.log(`[r0] animate ${on ? 'off' : 'on'}`);
      return !on;
    });
  };

  const barShift = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 280] });

  return (
    <View style={styles.screen}>
      <View style={styles.track}>
        <Animated.View style={[styles.bar, { transform: [{ translateX: barShift }] }]} />
      </View>

      <Text style={styles.title}>SimBridge R0</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Counter"
        onPressIn={onCounterPressIn}
        style={[styles.counter, count % 2 === 0 ? styles.counterEven : styles.counterOdd]}
      >
        <Text style={styles.counterText}>Tapped {count} times</Text>
      </Pressable>

      <Text style={styles.lastTap}>Last tap: {lastTap}</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Animate"
        onPressIn={onAnimatePressIn}
        style={[styles.animate, animate ? styles.animateOn : styles.animateOff]}
      >
        <Text style={styles.animateText}>Animate: {animate ? 'ON' : 'OFF'}</Text>
      </Pressable>

      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#ffffff' },
  track: {
    position: 'absolute',
    top: '12%',
    height: '4%',
    left: '5%',
    right: '5%',
    backgroundColor: '#eeeeee',
    overflow: 'hidden',
  },
  bar: { width: 60, height: '100%', backgroundColor: '#7c3aed' },
  title: {
    position: 'absolute',
    top: '25%',
    width: '100%',
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '700',
    color: '#111111',
  },
  counter: {
    position: 'absolute',
    top: '45%',
    height: '20%',
    left: '10%',
    right: '10%',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Two strongly different colours, so every tap changes the button's pixels.
  counterEven: { backgroundColor: '#1d4ed8' },
  counterOdd: { backgroundColor: '#f97316' },
  counterText: { color: '#ffffff', fontSize: 30, fontWeight: '700' },
  lastTap: {
    position: 'absolute',
    top: '68%',
    width: '100%',
    textAlign: 'center',
    fontSize: 20,
    color: '#333333',
    fontVariant: ['tabular-nums'],
  },
  animate: {
    position: 'absolute',
    top: '80%',
    height: '10%',
    left: '10%',
    right: '10%',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  animateOn: { backgroundColor: '#16a34a' },
  animateOff: { backgroundColor: '#6b7280' },
  animateText: { color: '#ffffff', fontSize: 22, fontWeight: '600' },
});

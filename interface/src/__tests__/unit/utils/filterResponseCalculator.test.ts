import { describe, it, expect } from 'vitest';
import { FilterResponseCalculator, type FilterType } from '$lib/utils/filterResponseCalculator';

describe('FilterResponseCalculator', () => {
	const calculator = new FilterResponseCalculator(44100);

	describe('constructor', () => {
		it('should use default sample rate of 44100', () => {
			const calc = new FilterResponseCalculator();
			const coeffs = calc.calculateCoefficients({
				type: 'lowpass',
				frequency: 1000,
				sampleRate: 44100
			});
			expect(coeffs).toBeDefined();
		});

		it('should accept custom sample rate', () => {
			const calc = new FilterResponseCalculator(48000);
			const coeffs = calc.calculateCoefficients({
				type: 'lowpass',
				frequency: 1000,
				sampleRate: 48000
			});
			expect(coeffs).toBeDefined();
		});
	});

	describe('calculateCoefficients', () => {
		describe('lowpass filter', () => {
			it('should calculate valid coefficients', () => {
				const coeffs = calculator.calculateCoefficients({
					type: 'lowpass',
					frequency: 1000,
					sampleRate: 44100,
					Q: 0.7071
				});

				expect(coeffs.a0).toBe(1); // Normalized
				expect(coeffs.b0).toBeDefined();
				expect(coeffs.b1).toBeDefined();
				expect(coeffs.b2).toBeDefined();
				expect(coeffs.a1).toBeDefined();
				expect(coeffs.a2).toBeDefined();
			});

			it('should have symmetric b0 and b2 for lowpass', () => {
				const coeffs = calculator.calculateCoefficients({
					type: 'lowpass',
					frequency: 1000,
					sampleRate: 44100
				});

				expect(coeffs.b0).toBeCloseTo(coeffs.b2, 10);
			});

			it('should have b1 = 2 * b0 for lowpass', () => {
				const coeffs = calculator.calculateCoefficients({
					type: 'lowpass',
					frequency: 1000,
					sampleRate: 44100
				});

				expect(coeffs.b1).toBeCloseTo(2 * coeffs.b0, 10);
			});
		});

		describe('highpass filter', () => {
			it('should calculate valid coefficients', () => {
				const coeffs = calculator.calculateCoefficients({
					type: 'highpass',
					frequency: 1000,
					sampleRate: 44100
				});

				expect(coeffs.a0).toBe(1);
				expect(coeffs.b0).toBeDefined();
			});

			it('should have b1 = -2 * b0 for highpass', () => {
				const coeffs = calculator.calculateCoefficients({
					type: 'highpass',
					frequency: 1000,
					sampleRate: 44100
				});

				// For highpass: b1 = -(1 + cosw0) and b0 = b2 = (1 + cosw0) / 2
				expect(coeffs.b1).toBeCloseTo(-2 * coeffs.b0, 10);
			});
		});

		describe('bandpass filter', () => {
			it('should calculate valid coefficients', () => {
				const coeffs = calculator.calculateCoefficients({
					type: 'bandpass',
					frequency: 1000,
					sampleRate: 44100
				});

				expect(coeffs.a0).toBe(1);
				expect(coeffs.b1).toBe(0); // b1 is always 0 for bandpass
			});

			it('should have b0 = -b2 for bandpass', () => {
				const coeffs = calculator.calculateCoefficients({
					type: 'bandpass',
					frequency: 1000,
					sampleRate: 44100
				});

				expect(coeffs.b0).toBeCloseTo(-coeffs.b2, 10);
			});
		});

		describe('notch filter', () => {
			it('should calculate valid coefficients', () => {
				const coeffs = calculator.calculateCoefficients({
					type: 'notch',
					frequency: 1000,
					sampleRate: 44100
				});

				expect(coeffs.a0).toBe(1);
				expect(coeffs.b0).toBeCloseTo(coeffs.b2, 10); // b0 = b2 = 1 (normalized)
			});
		});

		describe('peak filter', () => {
			it('should calculate valid coefficients with positive gain', () => {
				const coeffs = calculator.calculateCoefficients({
					type: 'peak',
					frequency: 1000,
					sampleRate: 44100,
					gain: 6
				});

				expect(coeffs.a0).toBe(1);
			});

			it('should calculate valid coefficients with negative gain', () => {
				const coeffs = calculator.calculateCoefficients({
					type: 'peak',
					frequency: 1000,
					sampleRate: 44100,
					gain: -6
				});

				expect(coeffs.a0).toBe(1);
			});

			it('should have unity coefficients at 0 dB gain', () => {
				const coeffs = calculator.calculateCoefficients({
					type: 'peak',
					frequency: 1000,
					sampleRate: 44100,
					gain: 0
				});

				// At 0 dB, peak filter should be unity (all-pass)
				expect(coeffs.b0).toBeCloseTo(1, 5);
			});
		});

		describe('shelf filters', () => {
			it('should calculate lowshelf coefficients', () => {
				const coeffs = calculator.calculateCoefficients({
					type: 'lowshelf',
					frequency: 200,
					sampleRate: 44100,
					gain: 6
				});

				expect(coeffs.a0).toBe(1);
			});

			it('should calculate highshelf coefficients', () => {
				const coeffs = calculator.calculateCoefficients({
					type: 'highshelf',
					frequency: 8000,
					sampleRate: 44100,
					gain: 6
				});

				expect(coeffs.a0).toBe(1);
			});
		});

		describe('allpass filter', () => {
			it('should calculate valid coefficients', () => {
				const coeffs = calculator.calculateCoefficients({
					type: 'allpass',
					frequency: 1000,
					sampleRate: 44100
				});

				expect(coeffs.a0).toBe(1);
			});
		});

		describe('bandwidth parameter', () => {
			it('should use bandwidth instead of Q when specified', () => {
				const coeffsWithQ = calculator.calculateCoefficients({
					type: 'bandpass',
					frequency: 1000,
					sampleRate: 44100,
					Q: 1
				});

				const coeffsWithBW = calculator.calculateCoefficients({
					type: 'bandpass',
					frequency: 1000,
					sampleRate: 44100,
					bandwidth: 1 // 1 octave
				});

				// Different alpha values should produce different coefficients
				expect(coeffsWithQ.b0).not.toBeCloseTo(coeffsWithBW.b0, 5);
			});
		});
	});

	describe('calculateFrequencyResponse', () => {
		it('should calculate magnitude and phase arrays', () => {
			const coeffs = calculator.calculateCoefficients({
				type: 'lowpass',
				frequency: 1000,
				sampleRate: 44100
			});

			const frequencies = [100, 1000, 10000];
			const response = calculator.calculateFrequencyResponse(coeffs, frequencies);

			expect(response.magnitude).toHaveLength(3);
			expect(response.phase).toHaveLength(3);
		});

		it('should show lowpass attenuation above cutoff', () => {
			const coeffs = calculator.calculateCoefficients({
				type: 'lowpass',
				frequency: 1000,
				sampleRate: 44100,
				Q: 0.7071
			});

			const frequencies = [100, 10000];
			const response = calculator.calculateFrequencyResponse(coeffs, frequencies);

			// Response at 100 Hz should be higher than at 10000 Hz
			expect(response.magnitude[0]).toBeGreaterThan(response.magnitude[1]);
		});

		it('should show highpass attenuation below cutoff', () => {
			const coeffs = calculator.calculateCoefficients({
				type: 'highpass',
				frequency: 1000,
				sampleRate: 44100,
				Q: 0.7071
			});

			const frequencies = [100, 10000];
			const response = calculator.calculateFrequencyResponse(coeffs, frequencies);

			// Response at 10000 Hz should be higher than at 100 Hz
			expect(response.magnitude[1]).toBeGreaterThan(response.magnitude[0]);
		});

		it('should show bandpass peak at center frequency', () => {
			const coeffs = calculator.calculateCoefficients({
				type: 'bandpass',
				frequency: 1000,
				sampleRate: 44100,
				Q: 5
			});

			const frequencies = [100, 1000, 10000];
			const response = calculator.calculateFrequencyResponse(coeffs, frequencies);

			// Response at 1000 Hz should be highest
			expect(response.magnitude[1]).toBeGreaterThan(response.magnitude[0]);
			expect(response.magnitude[1]).toBeGreaterThan(response.magnitude[2]);
		});

		it('should handle custom sample rate', () => {
			const coeffs = calculator.calculateCoefficients({
				type: 'lowpass',
				frequency: 1000,
				sampleRate: 48000
			});

			const frequencies = [100, 1000];
			const response = calculator.calculateFrequencyResponse(coeffs, frequencies, 48000);

			expect(response.magnitude).toHaveLength(2);
		});
	});

	describe('generateLogFrequencies', () => {
		it('should generate correct number of frequencies', () => {
			const frequencies = calculator.generateLogFrequencies(20, 20000, 100);
			expect(frequencies).toHaveLength(100);
		});

		it('should start at minimum frequency', () => {
			const frequencies = calculator.generateLogFrequencies(20, 20000, 100);
			expect(frequencies[0]).toBeCloseTo(20, 5);
		});

		it('should end at maximum frequency', () => {
			const frequencies = calculator.generateLogFrequencies(20, 20000, 100);
			expect(frequencies[99]).toBeCloseTo(20000, 0);
		});

		it('should be logarithmically spaced', () => {
			const frequencies = calculator.generateLogFrequencies(10, 10000, 4);
			// 10, 100, 1000, 10000 for log spacing
			expect(frequencies[0]).toBeCloseTo(10, 5);
			expect(frequencies[1]).toBeCloseTo(100, 3);
			expect(frequencies[2]).toBeCloseTo(1000, 1);
			expect(frequencies[3]).toBeCloseTo(10000, 0);
		});

		it('should use default values', () => {
			const frequencies = calculator.generateLogFrequencies();
			expect(frequencies[0]).toBeCloseTo(20, 5);
			expect(frequencies[frequencies.length - 1]).toBeCloseTo(20000, 0);
			expect(frequencies).toHaveLength(200);
		});
	});

	describe('calculateCombinedResponse', () => {
		it('should combine multiple filter responses', () => {
			const filters = [
				{ type: 'lowpass' as FilterType, frequency: 2000, sampleRate: 44100 },
				{ type: 'highpass' as FilterType, frequency: 200, sampleRate: 44100 }
			];

			const frequencies = [100, 1000, 10000];
			const response = calculator.calculateCombinedResponse(filters, frequencies);

			expect(response.magnitude).toHaveLength(3);
			expect(response.phase).toHaveLength(3);
		});

		it('should add magnitudes in dB', () => {
			const lowpass = { type: 'lowpass' as FilterType, frequency: 1000, sampleRate: 44100 };
			const frequencies = [100];

			const single = calculator.calculateCombinedResponse([lowpass], frequencies);
			const double = calculator.calculateCombinedResponse([lowpass, lowpass], frequencies);

			// Two identical filters should double the magnitude in dB
			expect(double.magnitude[0]).toBeCloseTo(single.magnitude[0] * 2, 5);
		});

		it('should handle empty filter array', () => {
			const frequencies = [100, 1000];
			const response = calculator.calculateCombinedResponse([], frequencies);

			expect(response.magnitude).toEqual([0, 0]);
			expect(response.phase).toEqual([0, 0]);
		});
	});

	describe('normalizedToFrequency', () => {
		it('should return minimum frequency at 0', () => {
			const freq = calculator.normalizedToFrequency(0);
			expect(freq).toBeCloseTo(20, 5);
		});

		it('should return maximum frequency at 1', () => {
			const freq = calculator.normalizedToFrequency(1);
			expect(freq).toBeCloseTo(20000, 0);
		});

		it('should return geometric mean at 0.5', () => {
			const freq = calculator.normalizedToFrequency(0.5);
			// Geometric mean of 20 and 20000 = sqrt(20 * 20000) ≈ 632.5 Hz
			expect(freq).toBeCloseTo(632.456, 0);
		});

		it('should accept custom min/max frequencies', () => {
			const freq = calculator.normalizedToFrequency(0.5, 100, 10000);
			// Geometric mean of 100 and 10000 = 1000 Hz
			expect(freq).toBeCloseTo(1000, 0);
		});
	});

	describe('normalizedToQ', () => {
		it('should return minimum Q at 0', () => {
			const q = calculator.normalizedToQ(0);
			expect(q).toBeCloseTo(0.1, 5);
		});

		it('should return maximum Q at 1', () => {
			const q = calculator.normalizedToQ(1);
			expect(q).toBeCloseTo(30, 0);
		});

		it('should use exponential scaling', () => {
			const q = calculator.normalizedToQ(0.5);
			// Geometric mean of 0.1 and 30 = sqrt(0.1 * 30) ≈ 1.732
			expect(q).toBeCloseTo(Math.sqrt(0.1 * 30), 3);
		});

		it('should accept custom min/max Q values', () => {
			const q = calculator.normalizedToQ(0.5, 0.5, 20);
			expect(q).toBeCloseTo(Math.sqrt(0.5 * 20), 3);
		});
	});

	describe('normalizedToGain', () => {
		it('should return 0 dB at 0.5', () => {
			const gain = calculator.normalizedToGain(0.5);
			expect(gain).toBe(0);
		});

		it('should return negative max gain at 0', () => {
			const gain = calculator.normalizedToGain(0);
			expect(gain).toBe(-24);
		});

		it('should return positive max gain at 1', () => {
			const gain = calculator.normalizedToGain(1);
			expect(gain).toBe(24);
		});

		it('should accept custom max gain', () => {
			const gain = calculator.normalizedToGain(1, 12);
			expect(gain).toBe(12);
		});

		it('should be linear', () => {
			const gain25 = calculator.normalizedToGain(0.25);
			const gain75 = calculator.normalizedToGain(0.75);
			expect(gain25).toBe(-12);
			expect(gain75).toBe(12);
		});
	});
});

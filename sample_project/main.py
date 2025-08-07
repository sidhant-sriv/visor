# main.py
from utils import DataProcessor, calculate_average
import math

def main():
    """Main function that demonstrates module usage."""
    data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    
    # Use the DataProcessor class
    processor = DataProcessor(data)
    result = processor.process()
    
    print(f"Data processing results: {result}")
    
    # Use imported function directly
    average = calculate_average(data)
    print(f"Direct average calculation: {average}")
    
    # Use standard library
    sqrt_avg = math.sqrt(average)
    print(f"Square root of average: {sqrt_avg}")

if __name__ == "__main__":
    main()
# utils.py
def calculate_sum(numbers):
    """Calculate the sum of a list of numbers."""
    total = 0
    for num in numbers:
        total += num
    return total

def calculate_average(numbers):
    """Calculate the average of a list of numbers."""
    if not numbers:
        return 0
    return calculate_sum(numbers) / len(numbers)

class DataProcessor:
    def __init__(self, data):
        self.data = data
    
    def process(self):
        """Process the data using the utility functions."""
        return {
            'sum': calculate_sum(self.data),
            'average': calculate_average(self.data),
            'count': len(self.data)
        }
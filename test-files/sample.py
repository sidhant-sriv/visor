def fibonacci(n):
    """Calculate the nth Fibonacci number"""
    if n <= 0:
        return 0
    elif n == 1:
        return 1
    else:
        a, b = 0, 1
        for i in range(2, n + 1):
            a, b = b, a + b
        return b

def process_numbers(numbers):
    """Process a list of numbers"""
    result = []
    
    for num in numbers:
        if num < 0:
            continue
        elif num == 0:
            result.append("zero")
        elif num % 2 == 0:
            result.append("even")
        else:
            result.append("odd")
    
    return result

def search_item(items, target):
    """Search for an item in a list"""
    index = 0
    
    while index < len(items):
        if items[index] == target:
            return index
        index += 1
    
    return -1  # Not found 
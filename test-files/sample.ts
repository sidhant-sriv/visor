function processOrder(order: any) {
    // Initialize variables
    let total = 0;
    let discount = 0;
    
    // Validate order
    if (!order || !order.items) {
        throw new Error('Invalid order');
    }
    
    // Calculate total
    for (const item of order.items) {
        total += item.price * item.quantity;
    }
    
    // Apply discount based on total
    if (total > 100) {
        discount = total * 0.1;
    } else if (total > 50) {
        discount = total * 0.05;
    }
    
    // Apply coupon if available
    if (order.coupon) {
        const couponDiscount = applyCoupon(order.coupon, total);
        discount = Math.max(discount, couponDiscount);
    }
    
    // Calculate final amount
    const finalAmount = total - discount;
    
    // Process payment
    if (finalAmount > 0) {
        processPayment(finalAmount);
        return {
            success: true,
            amount: finalAmount,
            discount: discount
        };
    } else {
        return {
            success: false,
            error: 'Invalid amount'
        };
    }
}

function applyCoupon(coupon: string, amount: number): number {
    // Simple coupon logic
    if (coupon === 'SAVE10') {
        return amount * 0.1;
    } else if (coupon === 'SAVE20') {
        return amount * 0.2;
    }
    return 0;
}

function processPayment(amount: number): void {
    console.log(`Processing payment of $${amount}`);
} 
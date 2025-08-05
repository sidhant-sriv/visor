#include <stdio.h>

int main()
{
    int x = 10;
    int y = 20;
    int z = 30;

    // Test nested if-else statements
    if (x > 5)
    {
        printf("x is greater than 5\n");

        if (y > 15)
        {
            printf("y is greater than 15\n");

            if (z > 25)
            {
                printf("z is greater than 25\n");

                // Test compound statement with multiple operations
                {
                    int temp = x + y + z;
                    printf("Sum: %d\n", temp);

                    if (temp > 50)
                    {
                        printf("Sum is greater than 50\n");
                    }
                    else
                    {
                        printf("Sum is not greater than 50\n");
                    }
                }
            }
            else
            {
                printf("z is not greater than 25\n");
            }
        }
        else
        {
            printf("y is not greater than 15\n");
        }
    }
    else
    {
        printf("x is not greater than 5\n");
    }

    // Test for loop with nested conditionals
    for (int i = 0; i < 5; i++)
    {
        if (i % 2 == 0)
        {
            printf("Even: %d\n", i);

            if (i > 2)
            {
                printf("Even and greater than 2: %d\n", i);
            }
        }
        else
        {
            printf("Odd: %d\n", i);
        }
    }

    // Test while loop with nested conditionals
    int count = 0;
    while (count < 3)
    {
        if (count == 1)
        {
            printf("Count is 1\n");

            if (x < y)
            {
                printf("x is less than y\n");
            }
        }
        else
        {
            printf("Count is %d\n", count);
        }
        count++;
    }

    // Test switch with nested conditionals
    switch (x)
    {
    case 10:
        printf("x is 10\n");

        if (y == 20)
        {
            printf("y is also 20\n");

            if (z == 30)
            {
                printf("z is also 30\n");
            }
        }
        break;

    case 20:
        printf("x is 20\n");
        break;

    default:
        printf("x is something else\n");

        if (x > 0)
        {
            printf("x is positive\n");
        }
        break;
    }

    return 0;
}

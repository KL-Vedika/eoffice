import psycopg2
from psycopg2 import sql # For safe SQL query construction

def print_postgres_schema(db_name, user, password, host="localhost", port="5432"):
    """
    Connects to a PostgreSQL database and prints its schema details.

    Args:
        db_name (str): The name of the database.
        user (str): The username for connecting to the database.
        password (str): The password for the user.
        host (str, optional): The database host. Defaults to "localhost".
        port (str, optional): The database port. Defaults to "5432".
    """
    conn = None
    try:
        conn_string = f"dbname='{db_name}' user='{user}' password='{password}' host='{host}' port='{port}'"
        conn = psycopg2.connect(conn_string)
        cur = conn.cursor()

        print(f"--- Database Schema for: {db_name} ---")

        # 1. Get Schemas (excluding system schemas)
        cur.execute("""
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
              AND schema_name NOT LIKE 'pg_temp_%' AND schema_name NOT LIKE 'pg_toast_temp_%'
            ORDER BY schema_name;
        """)
        schemas = [row[0] for row in cur.fetchall()]

        for schema_name in schemas:
            print(f"\n\n== SCHEMA: {schema_name} ==")

            # 2. Get Tables in the current schema
            print(f"\n  -- TABLES in schema '{schema_name}' --")
            cur.execute("""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = %s AND table_type = 'BASE TABLE'
                ORDER BY table_name;
            """, (schema_name,))
            tables = [row[0] for row in cur.fetchall()]

            if not tables:
                print("    (No tables found)")

            for table_name in tables:
                print(f"\n    TABLE: {schema_name}.{table_name}")

                # 2a. Columns
                print("      Columns:")
                cur.execute("""
                    SELECT column_name, data_type, is_nullable, column_default,
                           character_maximum_length, numeric_precision, numeric_scale
                    FROM information_schema.columns
                    WHERE table_schema = %s AND table_name = %s
                    ORDER BY ordinal_position;
                """, (schema_name, table_name))
                for col in cur.fetchall():
                    col_name, data_type, nullable, default, char_max, num_prec, num_scale = col
                    type_detail = data_type
                    if char_max:
                        type_detail += f"({char_max})"
                    elif num_prec and num_scale is not None:
                        type_detail += f"({num_prec},{num_scale})"
                    elif num_prec:
                        type_detail += f"({num_prec})"
                    
                    print(f"        - {col_name}: {type_detail} "
                          f"{'NULL' if nullable == 'YES' else 'NOT NULL'} "
                          f"{'(Default: ' + str(default) + ')' if default else ''}")

                # 2b. Constraints (PK, FK, UNIQUE, CHECK) using pg_constraint for definition
                print("      Constraints:")
                cur.execute("""
                    SELECT conname as constraint_name,
                           contype as constraint_type,
                           pg_get_constraintdef(c.oid) as constraint_definition
                    FROM pg_constraint c
                    JOIN pg_namespace n ON n.oid = c.connamespace
                    WHERE n.nspname = %s
                      AND c.conrelid = (
                          SELECT oid FROM pg_class
                          WHERE relname = %s AND relnamespace = (
                              SELECT oid FROM pg_namespace WHERE nspname = %s
                          )
                      )
                    ORDER BY conname;
                """, (schema_name, table_name, schema_name))
                constraints = cur.fetchall()
                if not constraints:
                    print("        (No explicit constraints found)")
                for con_name, con_type, con_def in constraints:
                    type_map = {'p': 'PRIMARY KEY', 'f': 'FOREIGN KEY', 'u': 'UNIQUE', 'c': 'CHECK'}
                    print(f"        - {con_name} ({type_map.get(con_type, con_type)}): {con_def}")

                # 2c. Indexes
                print("      Indexes:")
                cur.execute("""
                    SELECT indexname, indexdef
                    FROM pg_indexes
                    WHERE schemaname = %s AND tablename = %s;
                """, (schema_name, table_name))
                indexes = cur.fetchall()
                if not indexes:
                    print("        (No explicit indexes found beyond constraints)")
                for index_name, index_def in indexes:
                    # Avoid re-listing indexes created automatically for PK/UNIQUE constraints
                    is_constraint_index = False
                    for con_name, _, _ in constraints:
                        if con_name == index_name: # Simple check, PK/Unique constraint names often match index names
                            is_constraint_index = True
                            break
                    if not is_constraint_index:
                         print(f"        - {index_name}: {index_def}")


            # 3. Get Views in the current schema
            print(f"\n  -- VIEWS in schema '{schema_name}' --")
            cur.execute("""
                SELECT viewname, definition
                FROM pg_views
                WHERE schemaname = %s
                ORDER BY viewname;
            """, (schema_name,))
            views = cur.fetchall()
            if not views:
                print("    (No views found)")
            for view_name, definition in views:
                print(f"\n    VIEW: {schema_name}.{view_name}")
                print(f"      Definition:\n{indent_text(definition, 8)}")

            # 4. Get Functions/Procedures in the current schema
            print(f"\n  -- FUNCTIONS/PROCEDURES in schema '{schema_name}' --")
            cur.execute("""
                SELECT
                    p.proname AS routine_name,
                    pg_get_function_identity_arguments(p.oid) AS arguments,
                    pg_catalog.pg_get_function_result(p.oid) AS result_type,
                    CASE p.prokind
                        WHEN 'f' THEN 'FUNCTION'
                        WHEN 'p' THEN 'PROCEDURE'
                        WHEN 'a' THEN 'AGGREGATE FUNCTION'
                        WHEN 'w' THEN 'WINDOW FUNCTION'
                        ELSE 'UNKNOWN'
                    END as routine_type,
                    pg_get_functiondef(p.oid) as definition
                FROM pg_catalog.pg_proc p
                LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = %s
                  AND p.proisagg = false -- Exclude aggregate support functions if not 'a'
                  AND NOT EXISTS ( -- Exclude functions that are part of extensions
                    SELECT 1 FROM pg_depend d
                    JOIN pg_extension e ON d.refobjid = e.oid
                    WHERE d.objid = p.oid AND d.deptype = 'e'
                  )
                ORDER BY routine_name;
            """, (schema_name,))
            routines = cur.fetchall()
            if not routines:
                print("    (No user-defined functions or procedures found)")
            for r_name, r_args, r_result, r_type, r_def in routines:
                print(f"\n    {r_type}: {schema_name}.{r_name}({r_args if r_args else ''})")
                if r_type != 'PROCEDURE': # Procedures don't have a return type in the same way
                    print(f"      Returns: {r_result}")
                # print(f"      Definition:\n{indent_text(r_def, 8)}") # Definition can be very long

        cur.close()

    except psycopg2.Error as e:
        print(f"Database connection error or query error: {e}")
    finally:
        if conn:
            conn.close()
            print("\n--- Connection closed ---")

def indent_text(text, spaces):
    """Helper function to indent multi-line text."""
    if not text: return ""
    return '\n'.join(' ' * spaces + line for line in text.splitlines())

# --- Example Usage ---
if __name__ == "__main__":
    # Replace with your actual database credentials
    DB_NAME = "postgres"
    DB_USER = "postgres"
    DB_PASSWORD = "80082Ram"
    DB_HOST = "100.120.1.23"  # or your DB host
    DB_PORT = "5432"       # or your DB port

    print(f"Attempting to connect to database '{DB_NAME}' on {DB_HOST}:{DB_PORT}...")
    print_postgres_schema(DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT)

    # Example with a non-existent DB to show error handling
    # print("\nAttempting to connect to a non-existent database...")
    # print_postgres_schema("non_existent_db", "user", "pass")
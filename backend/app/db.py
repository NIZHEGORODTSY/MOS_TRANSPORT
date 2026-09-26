import os
import psycopg2


DATABASE_URL='postgresql://postgres:p%40ssw0rd173@5.227.60.94:546/buses'


def get_connection():
    return psycopg2.connect(DATABASE_URL)

def get_stops(id=122048):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM schedule_plan_tr_"+str(id)+"_street_loop")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    f=[]
    for i in rows:
        f.append([i[7],i[8]])
    print(f)
    return f
create table if not exists people (
 id serial primary key, name text not null, email text unique not null, password_hash text not null,
 role text not null check(role in ('employee','manager','admin')), manager int references people
);
create table if not exists policy(id int primary key check(id=1), notice int not null check(notice>=0), capacity int not null check(capacity>0));
create table if not exists kinds(id serial primary key,name text unique not null,allowance int not null check(allowance>=0));
create table if not exists holidays(day date primary key,name text not null);
create table if not exists requests(id serial primary key,employee int not null references people,kind int not null references kinds,
 start_date date not null,end_date date not null check(end_date>=start_date),reason text not null,
 status text not null check(status in ('pending','approved','rejected','cancelled')));
create table if not exists charged_days(request int references requests,day date not null,primary key(request,day));
create index if not exists charged_day_idx on charged_days(day);
create table if not exists sessions(id uuid primary key,person int not null references people,digest text unique not null,expires timestamptz not null);
create table if not exists audit(id serial primary key,actor int references people,action text not null,target int,created timestamptz default now());

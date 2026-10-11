'use client';

import {
  useApproveLoan, useApplyForLoan, useCheckBorrowerEligibility, useCreateEmployee, useDisburseLoan,
  useDownloadBorrowerSalarySlip, useDownloadSanctionSalarySlip, useGetBorrowerLoan, useGetBorrowerProfile,
  useGetCurrentUser, useGetDashboardStats, useListBorrowerLoans, useListCollectionLoans,
  useListDisbursementLoans, useListEmployees, useListLoanPayments, useListSalesLeads,
  useListSanctionLoans, useLogIn, useLogOut, useRecordLoanPayment,
  useRejectLoan, useSignUp, useUpdateBorrowerProfile, useUpdateEmployeeStatus,
  getGetBorrowerProfileQueryKey, getGetCurrentUserQueryKey, getGetDashboardStatsQueryKey,
  getDownloadSanctionSalarySlipQueryKey,
  getListBorrowerLoansQueryKey, getListCollectionLoansQueryKey, getListDisbursementLoansQueryKey,
  getListEmployeesQueryKey, getListLoanPaymentsQueryKey, getListSalesLeadsQueryKey, getListSanctionLoansQueryKey,
} from '@workspace/api-client-react';
import type { BorrowerProfileInput, EmployeeCreateInput, EmployeeRole, Loan, PaymentInput, User, UserRole } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowRight, BadgeCheck, Banknote, Check, CheckCircle2, ChevronRight, ClipboardList,
  Eye, EyeOff, FileCheck2, HandCoins, Home, LogOut, Search, ShieldCheck, UserPlus, Users, Wallet, X,
  AlertCircle, LoaderCircle, Download, Phone,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type InputHTMLAttributes, type ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { SalarySlipUpload } from '@/components/salary-slip-upload';

type Page = 'home'|'login'|'signup'|'borrower'|'borrower-loans'|'operations'|'sales'|'sanction'|'disbursement'|'collection'|'employees';
const PAGE_ROLES: Record<Exclude<Page, 'home'|'login'|'signup'>, readonly UserRole[]> = {
  borrower: ['BORROWER'],
  'borrower-loans': ['BORROWER'],
  operations: ['ADMIN', 'SALES', 'SANCTION', 'DISBURSEMENT', 'COLLECTION'],
  sales: ['ADMIN', 'SALES'],
  sanction: ['ADMIN', 'SANCTION'],
  disbursement: ['ADMIN', 'DISBURSEMENT'],
  collection: ['ADMIN', 'COLLECTION'],
  employees: ['ADMIN'],
};
const EMPLOYEE_ROLE_OPTIONS: EmployeeRole[] = ['SALES', 'SANCTION', 'DISBURSEMENT', 'COLLECTION'];
const fmtINR = (paise: number) => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Math.round(paise/100));
const fmtRupees = (amount: number) => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(amount);
const fmtDate = (date?: string|null) => date ? new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(date)) : '—';
const titleCase = (v: string) => v.toLowerCase().replaceAll('_',' ').replace(/\b\w/g, c=>c.toUpperCase());
const getError = (error: unknown): string => {
  if (!error) return '';
  const e = error as { message?: string; data?: { error?: string; fieldErrors?: {field:string;message:string}[] } };
  return e.data?.fieldErrors?.map(x=>`${titleCase(x.field)}: ${x.message}`).join(' · ') || e.data?.error || e.message || 'Something went wrong. Please try again.';
};
const initials = (name?: string) => name?.split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase() || 'CS';
function Status({value}:{value:string}) { return <span className={`badge ${value.toLowerCase()}`} data-testid={`status-${value.toLowerCase()}`}>{titleCase(value)}</span>; }
function LoadingRows({count=4}:{count?:number}) { return <div aria-label="Loading records" className="card-pad">{Array.from({length:count},(_,i)=><div key={i} className="skeleton" style={{height:38,marginBottom:12}} />)}</div>; }
function QueryError({error,retry}:{error:unknown;retry:()=>void}) { return <div className="empty-state"><div className="empty-icon"><AlertCircle size={20}/></div><div className="empty-title">We couldn’t load this yet</div><p className="empty-copy">{getError(error)}</p><button className="text-btn" onClick={retry} data-testid="button-retry">Try again</button></div>; }
type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { 'data-testid'?: string };
function PasswordInput({ id, className, 'data-testid': testId, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="password-wrap">
      <input id={inputId} className={className ?? 'input'} type={visible ? 'text' : 'password'} data-testid={testId} {...props} />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        data-testid={testId ? `${testId}-toggle` : 'button-toggle-password'}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
function Empty({title,copy}:{title:string;copy:string}) { return <div className="empty-state"><div className="empty-icon"><FileCheck2 size={20}/></div><div className="empty-title">{title}</div><p className="empty-copy">{copy}</p></div>; }

const borrowerNav = [
  {href:'/borrower',label:'Apply for a loan',icon:HandCoins},
  {href:'/borrower/loans',label:'My applications',icon:ClipboardList},
];
const opsNav = [
  {href:'/operations',label:'Overview',icon:Home},
  {href:'/operations/sales',label:'Sales leads',icon:Users},
  {href:'/operations/sanction',label:'Sanction queue',icon:BadgeCheck},
  {href:'/operations/disbursement',label:'Disbursement',icon:Banknote},
  {href:'/operations/collection',label:'Collections',icon:Wallet},
  {href:'/operations/employees',label:'Employees',icon:UserPlus},
];
function AppShell({page, user, children}:{page:Page;user?:User;children:ReactNode}) {
  const router = useRouter();
  const logout = useLogOut();
  const queryClient = useQueryClient();
  const operations = !!user && user.role !== 'BORROWER';
  const operationPath = user?.role === 'SALES' ? '/operations/sales' : user?.role === 'SANCTION' ? '/operations/sanction' : user?.role === 'DISBURSEMENT' ? '/operations/disbursement' : user?.role === 'COLLECTION' ? '/operations/collection' : null;
  const nav = operations
    ? user?.role === 'ADMIN'
      ? opsNav
      : opsNav.filter(item => item.href === '/operations' || item.href === operationPath)
    : borrowerNav;
  const section = operations ? 'Operations workspace' : 'Borrower workspace';
  const onLogout = () => logout.mutate(undefined,{onSuccess:()=>{queryClient.clear();router.push('/login');}});
  const active = (href:string) => href === '/operations' ? page === 'operations' : page === 'sales' ? href === '/operations/sales' : page === 'sanction' ? href === '/operations/sanction' : page === 'disbursement' ? href === '/operations/disbursement' : page === 'collection' ? href === '/operations/collection' : page === 'employees' ? href === '/operations/employees' : page === 'borrower-loans' ? href === '/borrower/loans' : page === 'borrower' && href === '/borrower';
  return <div className="app-layout">
    <aside className="side-rail">
      <Link className="brand-row" href="/"><span className="brand-mark">C</span><span><span className="brand-name">creditsea</span><span className="brand-sub">Finance, made clear</span></span></Link>
      <div className="nav-label">{section}</div>
      <nav className="nav-list" aria-label={section}>{nav.map(({href,label,icon:Icon})=><Link key={href} href={href} className={`nav-item ${active(href)?'active':''}`} data-testid={`link-${href.slice(1).replaceAll('/','-')}`}><Icon className="nav-icon"/>{label}</Link>)}</nav>
      <div className="rail-bottom"><div className="rail-note">Your money deserves straightforward answers.<br/>We’re here to help.</div></div>
    </aside>
    <div className="main-column">
      <header className="topbar"><div className="topbar-kicker">{page === 'borrower' ? 'A clear path to your next step' : page === 'collection' ? 'Payments & account balances' : 'CreditSea / '+titleCase(page.replace('borrower-',''))}</div>
        <div className="topbar-user"><div className="avatar">{initials(user?.name)}</div><div><div className="user-name" data-testid="text-username">{user?.name || 'Account'}</div><div className="user-role">{titleCase(user?.role || 'Borrower')}</div></div><button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={onLogout} disabled={logout.isPending} data-testid="button-logout"><LogOut size={16}/></button></div>
      </header>
      <main className="content-wrap fade-in">{children}</main>
      <nav className="mobile-nav" aria-label="Mobile navigation">{nav.map(({href,label,icon:Icon})=><Link key={href} href={href} className={active(href)?'active':''} data-testid={`mobile-${href.slice(1).replaceAll('/','-')}`}><Icon/><span>{label.split(' ')[0]}</span></Link>)}</nav>
    </div>
  </div>;
}

function AuthPage({signup}:{signup:boolean}) {
  const router=useRouter(), queryClient=useQueryClient();
  const signUp=useSignUp(), logIn=useLogIn();
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState('');
  const mutation=signup?signUp:logIn, error=mutation.error;
  const passwordsMatch=!signup||(password.length>0&&password===confirmPassword);
  const passwordMismatch=signup&&confirmPassword.length>0&&password!==confirmPassword;
  const submit=(e:FormEvent)=>{e.preventDefault(); if(signup&&!passwordsMatch)return; if(signup) signUp.mutate({data:{name,email,password}},{onSuccess:(response)=>{queryClient.setQueryData(getGetCurrentUserQueryKey(),response.user);router.push('/borrower');}}); else logIn.mutate({data:{email,password}},{onSuccess:(response)=>{queryClient.setQueryData(getGetCurrentUserQueryKey(),response.user);router.push(response.user.role==='BORROWER'?'/borrower':'/operations');}});};
  return <div className="auth-page">
    <aside className="auth-aside"><Link className="brand-row" href="/"><span className="brand-mark">C</span><span><span className="brand-name">creditsea</span><span className="brand-sub">Finance, made clear</span></span></Link><div className="aside-copy"><div className="eyebrow">A more human way to borrow</div><h2>Money moves.<br/>Make your next<br/>move with clarity.</h2><p>Thoughtful credit, transparent terms, and a team that’s with you at every step.</p></div><div className="aside-foot">Secure by design · Built for India</div></aside>
    <main className="auth-main"><div className="auth-box"><div className="eyebrow">{signup?'Get started':'Welcome back'}</div><h1>{signup?'A little about you.':'Good to see you again.'}</h1><p>{signup?'Create your secure CreditSea account. It takes less than a minute.':'Sign in to pick up where you left off.'}</p>
      <form className="auth-form" onSubmit={submit}>
        {signup&&<div className="field"><label htmlFor="full-name">Full name</label><input id="full-name" className="input" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="As it appears on your PAN" data-testid="input-name"/></div>}
        <div className="field"><label htmlFor="email">Email address</label><input id="email" className="input" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" data-testid="input-email"/></div>
        <div className="field"><label htmlFor="password">Password</label><PasswordInput id="password" autoComplete={signup?'new-password':'current-password'} required minLength={signup?12:1} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} placeholder={signup?'At least 12 characters':'Your password'} data-testid="input-password"/>{signup&&<small className="helper">Use at least 12 characters for a stronger account.</small>}</div>
        {signup&&<div className="field"><label htmlFor="confirm-password">Confirm password</label><PasswordInput id="confirm-password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="Re-enter your password" data-testid="input-confirm-password" aria-invalid={passwordMismatch||undefined}/>{passwordMismatch?<small className="helper" style={{color:'#b42318'}} data-testid="status-password-mismatch">Passwords do not match.</small>:<small className="helper">Both passwords must match to continue.</small>}</div>}
        {error&&<div className="notice error" role="alert" data-testid="status-auth-error">{getError(error)}</div>}
        <button type="submit" disabled={mutation.isPending||(signup&&!passwordsMatch)} className="primary-btn" style={{width:'100%',padding:13}} data-testid={signup?'button-signup':'button-login'}>{mutation.isPending?<><LoaderCircle size={15} className="spin"/> Working…</>:signup?'Create account':'Sign in'}{!mutation.isPending&&<ArrowRight size={15}/>}</button>
      </form>
      <div className="auth-switch">{signup?'Already have an account?':'New to CreditSea?'}<Link href={signup?'/login':'/signup'}>{signup?'Sign in':'Create an account'}</Link></div>
      <div style={{display:'flex',alignItems:'center',gap:8,marginTop:28,color:'#879087',fontSize:10}}><ShieldCheck size={14} color="#367466"/> Your details are encrypted and kept private</div>
    </div></main>
  </div>;
}

function Entry({user}:{user?:User}) {
  const router=useRouter();
  useEffect(()=>{if(user)router.replace(user.role==='BORROWER'?'/borrower':'/operations');},[user,router]);
  return <div className="auth-page">
    <aside className="auth-aside">
      <Link className="brand-row" href="/"><span className="brand-mark">C</span><span className="brand-name">creditsea</span></Link>
      <div className="aside-copy">
        <div className="eyebrow">Personal finance, made clear</div>
        <h2>A simpler way to move forward.</h2>
        <p>One secure place to understand your options, follow every decision, and keep your loan details close.</p>
        <div className="grid" style={{gap:12,marginTop:30}}>
          <div className="card card-pad" style={{background:'#F8F6EF',color:'#153A35',borderColor:'rgba(255,255,255,.4)'}}><strong>Know where you stand</strong><p className="section-caption" style={{color:'#5E6D68'}}>Check eligibility and see each application update in one place.</p></div>
          <div className="card card-pad" style={{background:'#F8F6EF',color:'#153A35',borderColor:'rgba(255,255,255,.4)'}}><strong>Stay in control</strong><p className="section-caption" style={{color:'#5E6D68'}}>Review repayment details and access your documents securely.</p></div>
        </div>
      </div>
      <div className="rail-note">Clear steps. Secure records. Support when you need it.</div>
    </aside>
    <main className="auth-main">
      <div className="auth-box">
        <div className="eyebrow">CreditSea loan portal</div>
        <h1>Start with clarity.</h1>
        <p>Choose how you’d like to continue. Borrowers can create an account; staff can sign in to their assigned workspace.</p>
        <div className="grid" style={{gap:12,marginTop:26}}>
          <Link className="primary-btn" href="/signup" data-testid="link-create-account">Create borrower account <ArrowRight size={15}/></Link>
          <Link className="secondary-btn" href="/login" data-testid="link-sign-in">Sign in to CreditSea <ArrowRight size={15}/></Link>
        </div>
        <p className="section-caption" style={{marginTop:20}}>Your account is protected with secure sign-in and private document storage.</p>
      </div>
    </main>
  </div>;
}

function PageHeading({eyebrow,title,subtitle,action}:{eyebrow:string;title:string;subtitle:string;action?:React.ReactNode}) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="page-subtitle">{subtitle}</p></div>{action}</div>; }
function StatsCard({label,value,detail,icon:Icon}:{label:string;value:string;detail:string;icon:typeof Activity}) { return <div className="card stat-card"><div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div className="stat-label">{label}</div><Icon size={16} color="#70877d"/></div><div className="stat-value" data-testid={`stat-${label.toLowerCase().replaceAll(' ','-')}`}>{value}</div><div className="stat-detail">{detail}</div></div>; }
function LoansTable({items,onSelect,actions}:{items:Loan[];onSelect:(l:Loan)=>void;actions?:(l:Loan)=>React.ReactNode}) {
  if(!items.length) return <Empty title="Nothing in this queue" copy="New records will appear here as they move through the CreditSea process." />;
  return <div className="table-wrap"><table><thead><tr><th>Borrower</th><th>Loan reference</th><th>Amount</th><th>Tenure</th><th>Status</th><th> </th></tr></thead><tbody>{items.map(l=><tr key={l.id} data-testid={`row-loan-${l.id}`}><td><div style={{fontWeight:700}}>{l.borrowerName}</div><div className="helper">{l.borrowerEmail}</div></td><td className="mono">{l.reference}</td><td className="currency">{fmtINR(l.principalPaise)}</td><td>{l.tenureDays} days</td><td><Status value={l.status}/></td><td>{actions?actions(l):<button className="text-btn" onClick={()=>onSelect(l)} data-testid={`button-view-loan-${l.id}`}>Details <ChevronRight size={14}/></button>}</td></tr>)}</tbody></table></div>;
}
function LeadTable({items,onSelect}:{items:{id:string;name:string;email:string;registeredAt:string;status:string}[];onSelect:(lead:{id:string;name:string;email:string;registeredAt:string;status:string})=>void}) {
  if(!items.length)return <Empty title="No unapplied leads" copy="Registered borrowers without a loan application will appear here." />;
  return <div className="table-wrap"><table><thead><tr><th>Borrower</th><th>Registered</th><th>Status</th><th></th></tr></thead><tbody>{items.map(x=><tr key={x.id} data-testid={`row-lead-${x.id}`}><td><div style={{fontWeight:700}}>{x.name}</div><div className="helper">{x.email}</div></td><td>{fmtDate(x.registeredAt)}</td><td><Status value={x.status}/></td><td><button className="text-btn" onClick={()=>onSelect(x)} data-testid={`button-view-lead-${x.id}`}>View <ChevronRight size={14}/></button></td></tr>)}</tbody></table></div>;
}
function LoansDialog({loan,onClose}:{loan:Loan;onClose:()=>void}) {
  const {data,error,isLoading,refetch}=useGetBorrowerLoan(loan.id,{query:{queryKey:[`/api/borrower/loans/${loan.id}`]}});
  const download=useDownloadBorrowerSalarySlip(loan.id,{query:{enabled:false,queryKey:[`/api/borrower/loans/${loan.id}/salary-slip`]}});
  const queryClient=useQueryClient();
  const current=data||loan;
  const onDownload=async()=>{const result=await download.refetch();if(result.data){const url=URL.createObjectURL(result.data);const a=document.createElement('a');a.href=url;a.download=`salary-slip-${loan.reference}`;a.click();URL.revokeObjectURL(url);}};
  return <Dialog title={loan.reference} onClose={onClose}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><div className="section-caption">Application status</div><div style={{marginTop:8}}><Status value={current.status}/></div></div><div style={{textAlign:'right'}}><div className="section-caption">Loan amount</div><div className="section-title" style={{marginTop:6}}>{fmtINR(current.principalPaise)}</div></div></div>
    {isLoading?<LoadingRows count={2}/>:error?<div className="notice error" role="alert">{getError(error)} <button className="text-btn" onClick={()=>refetch()}>Retry</button></div>:null}
    <div className="separator"/>
    <div className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:14}}><div><div className="helper">Interest rate</div><strong>{current.interestRatePercent}%</strong></div><div><div className="helper">Tenure</div><strong>{current.tenureDays} days</strong></div><div><div className="helper">Total repayment</div><strong>{fmtINR(current.totalRepaymentPaise)}</strong></div><div><div className="helper">Outstanding</div><strong>{fmtINR(current.outstandingBalancePaise)}</strong></div></div>
    {current.rejectionReason&&<div className="notice error" style={{marginTop:18}}>Reason: {current.rejectionReason}</div>}
    {current.status==='DISBURSED'&&<div style={{marginTop:20}}><button className="secondary-btn" onClick={onDownload} disabled={download.isFetching||!current.salarySlipAvailable} data-testid="button-download-slip"><Download size={14}/>{download.isFetching?'Preparing…':'Download salary slip'}</button>{download.error&&<div className="notice error" style={{marginTop:8}}>{getError(download.error)}</div>}</div>}
    <div className="form-actions"><button className="secondary-btn" onClick={()=>{queryClient.invalidateQueries({queryKey:[`/api/borrower/loans/${loan.id}`]});onClose();}}>Done</button></div>
  </Dialog>;
}
function Dialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[onClose]);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="dialog" role="dialog" aria-modal="true" aria-label={title}><div className="dialog-head"><div><div className="eyebrow">Record details</div><h2 className="section-title">{title}</h2></div><button className="icon-btn" onClick={onClose} aria-label="Close dialog" data-testid="button-close-dialog"><X size={18}/></button></div>{children}</section></div>;
}

function BorrowerApplication() {
  const qc=useQueryClient(), profileQuery=useGetBorrowerProfile();
  const update=useUpdateBorrowerProfile(), eligibility=useCheckBorrowerEligibility(), apply=useApplyForLoan();
  const [name,setName]=useState(''),[pan,setPan]=useState(''),[dob,setDob]=useState(''),[salary,setSalary]=useState(''),[employment,setEmployment]=useState('SALARIED');
  const [eligibilityResult,setEligibilityResult]=useState<{eligible:boolean;errors:{field:string;message:string}[]}|null>(null);
  const [amount,setAmount]=useState(150000),[tenure,setTenure]=useState(180),[submitted,setSubmitted]=useState<Loan|null>(null);
  const profile=profileQuery.data;
  useEffect(()=>{if(profile){setName(profile.name);setDob(profile.dateOfBirth||'');setSalary(profile.monthlySalaryRupees?.toString()||'');setEmployment(profile.employmentMode||'SALARIED');}},[profile]);
  const payload=():BorrowerProfileInput=>({name:name.trim(),pan:pan.trim().toUpperCase(),dateOfBirth:dob,monthlySalaryRupees:Number(salary),employmentMode:employment as BorrowerProfileInput['employmentMode']});
  const fieldsValid=name.trim().length>=2&&/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/.test(pan.trim())&&!!dob&&Number(salary)>=0;
  const setResult=(res:{eligible:boolean;errors:{field:string;message:string}[]})=>setEligibilityResult(res);
  const evaluate=(save:boolean)=>{const body=payload();const op=save?update:eligibility;op.mutate({data:body},{onSuccess:res=>{setResult({eligible:res.eligible,errors:res.errors});qc.invalidateQueries({queryKey:getGetBorrowerProfileQueryKey()});if(save)window.scrollTo({top:0,behavior:'smooth'});}});};
  const interest=Math.round(amount*0.12*tenure/365), repayment=amount+interest;
  const submitApplication=()=>apply.mutate({data:{loanAmountRupees:amount,tenureDays:tenure,idempotencyKey:`creditsea-${Date.now()}-${Math.random().toString(36).slice(2,12)}`}},{onSuccess:loan=>{setSubmitted(loan);qc.invalidateQueries({queryKey:getListBorrowerLoansQueryKey()});qc.invalidateQueries({queryKey:getGetBorrowerProfileQueryKey()});}});
  if(profileQuery.isLoading)return <><PageHeading eyebrow="Your application" title="Let’s find your fit." subtitle="A few details help us understand what works for you."/><div className="card"><LoadingRows count={6}/></div></>;
  if(profileQuery.error)return <><PageHeading eyebrow="Your application" title="Let’s find your fit." subtitle="We couldn't retrieve your profile just now."/><QueryError error={profileQuery.error} retry={()=>profileQuery.refetch()}/></>;
  if(submitted)return <div className="card card-pad fade-in" style={{maxWidth:650,margin:'24px auto',textAlign:'center'}}><div className="empty-icon" style={{width:58,height:58}}><CheckCircle2 size={25}/></div><div className="eyebrow">Application received</div><h1 style={{fontSize:30}}>You’re in good hands.</h1><p className="page-subtitle" style={{maxWidth:400,margin:'0 auto 20px'}}>Your application <strong>{submitted.reference}</strong> is now in review. We’ll keep you updated as it moves forward.</p><div className="loan-hero" style={{textAlign:'left',margin:'22px 0'}}><div className="eyebrow">Requested amount</div><div className="loan-hero-value">{fmtINR(submitted.principalPaise)}</div><div className="loan-hero-sub">{submitted.tenureDays} day repayment period · 12% annual interest</div></div><Link className="primary-btn" href="/borrower/loans" data-testid="link-view-applications">View my applications <ArrowRight size={15}/></Link></div>;
  const currentEligibility=eligibilityResult?.eligible ?? profile?.eligibilityStatus==='ELIGIBLE';
  const mutationError=update.error||eligibility.error||apply.error;
  return <><PageHeading eyebrow="Borrower portal" title="A loan that fits your life." subtitle="Share a few details and we’ll show you what’s possible."/>
    <div className="step-row"><div className="step active"><span className="step-dot">1</span> Your details</div><div className="step-line"/><div className={`step ${currentEligibility?'active':''}`}><span className="step-dot">{currentEligibility?<Check size={12}/>:2}</span> Eligibility</div><div className="step-line"/><div className={`step ${profile?.salarySlip?'active':''}`}><span className="step-dot">{profile?.salarySlip?<Check size={12}/>:3}</span> Your offer</div></div>
    {profile?.eligibilityStatus==='ELIGIBLE'&&<div className="notice success" style={{marginBottom:18}}><CheckCircle2 size={14} style={{verticalAlign:'middle',marginRight:6}}/>Profile checked. Your details are eligible for an application.</div>}
    {mutationError&&<div className="notice error" role="alert" style={{marginBottom:18}} data-testid="status-form-error">{getError(mutationError)}</div>}
    <div className="grid split-grid">
      <section className="card card-pad"><div className="card-head" style={{padding:0,border:0,marginBottom:18}}><div><h2 className="section-title">Personal & income details</h2><p className="section-caption">Your PAN is used for verification and is never displayed in full.</p></div><ShieldCheck size={18} color="#438274"/></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="borrower-name">Full legal name</label><input id="borrower-name" className="input" value={name} onChange={e=>setName(e.target.value)} autoComplete="name" required minLength={2} data-testid="input-borrower-name"/></div>
          <div className="field"><label htmlFor="pan">PAN number</label><input id="pan" className="input" value={pan} onChange={e=>setPan(e.target.value.toUpperCase().slice(0,10))} placeholder={profile?.panMasked||'ABCDE1234F'} maxLength={10} autoCapitalize="characters" aria-describedby="pan-help" required data-testid="input-pan"/><small id="pan-help" className="helper">{profile?.panMasked?`On file: ${profile.panMasked}. Enter PAN to update.`:'10 characters. Your PAN is kept private.'}</small></div>
          <div className="field"><label htmlFor="dob">Date of birth</label><input id="dob" className="input" type="date" value={dob} onChange={e=>setDob(e.target.value)} required data-testid="input-dob"/></div>
          <div className="field"><label htmlFor="salary">Monthly income (₹)</label><input id="salary" className="input" type="number" min={0} max={100000000} value={salary} onChange={e=>setSalary(e.target.value)} required data-testid="input-salary"/><small className="helper">Your current gross monthly income.</small></div>
          <div className="field"><label htmlFor="employment">Employment mode</label><select id="employment" className="select" value={employment} onChange={e=>setEmployment(e.target.value)} data-testid="select-employment"><option value="SALARIED">Salaried</option><option value="SELF_EMPLOYED">Self-employed</option><option value="UNEMPLOYED">Unemployed</option></select></div>
        </div>
        {(eligibilityResult?.errors.length||profile?.eligibilityErrors.length)&&<div className="notice error" style={{marginTop:16}}>{(eligibilityResult?.errors||profile?.eligibilityErrors||[]).map(x=><div key={x.field}><strong>{titleCase(x.field)}:</strong> {x.message}</div>)}</div>}
        <div className="form-actions"><button className="secondary-btn" onClick={()=>evaluate(false)} disabled={!fieldsValid||eligibility.isPending} data-testid="button-check-eligibility">{eligibility.isPending?'Checking…':'Check eligibility'}</button><button className="primary-btn" onClick={()=>evaluate(true)} disabled={!fieldsValid||update.isPending} data-testid="button-save-profile">{update.isPending?'Saving…':'Save details'} <ArrowRight size={14}/></button></div>
      </section>
      <div className="grid" style={{alignContent:'start'}}>
        <SalarySlipUpload existing={profile?.salarySlip} />
        <section className={`loan-hero ${!currentEligibility?'':'fade-in'}`}><div className="eyebrow">Repayment preview</div><div className="loan-hero-value">{fmtRupees(repayment)}</div><div className="loan-hero-sub">Indicative total · subject to final review</div><div className="separator" style={{background:'rgba(238,246,241,.18)',margin:'17px 0'}}/><div style={{display:'flex',justifyContent:'space-between',fontSize:11}}><span>Principal</span><strong>{fmtRupees(amount)}</strong></div><div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginTop:8}}><span>Interest · 12% p.a.</span><strong>{fmtRupees(interest)}</strong></div></section>
      </div>
    </div>
    <section className="card card-pad" style={{marginTop:18}}><div style={{display:'flex',justifyContent:'space-between',gap:20,alignItems:'flex-start',flexWrap:'wrap'}}><div><h2 className="section-title">Shape your repayment</h2><p className="section-caption">Choose an amount and tenure that feels manageable.</p></div><div className="helper" style={{maxWidth:250}}>All figures are indicative; your final offer is subject to underwriting.</div></div>
      <div className="grid" style={{gridTemplateColumns:'1fr 1fr',marginTop:20,gap:28}}>
        <div><div style={{display:'flex',justifyContent:'space-between',fontSize:12,fontWeight:700}}><label htmlFor="loan-amount">Loan amount</label><span className="currency">{fmtRupees(amount)}</span></div><input className="range" id="loan-amount" type="range" min={50000} max={500000} step={5000} value={amount} onChange={e=>setAmount(Number(e.target.value))} aria-label="Loan amount in rupees" data-testid="slider-loan-amount"/><div className="range-row"><span>₹50,000</span><span>₹5,00,000</span></div></div>
        <div><div style={{display:'flex',justifyContent:'space-between',fontSize:12,fontWeight:700}}><label htmlFor="tenure">Repayment tenure</label><span>{tenure} days</span></div><input className="range" id="tenure" type="range" min={30} max={365} step={15} value={tenure} onChange={e=>setTenure(Number(e.target.value))} aria-label="Repayment tenure in days" data-testid="slider-tenure"/><div className="range-row"><span>30 days</span><span>365 days</span></div></div>
      </div>
      <div className="form-actions" style={{borderTop:'1px solid #efebe3',marginTop:18}}><button className="primary-btn" onClick={submitApplication} disabled={!currentEligibility||!profile?.salarySlip||apply.isPending} title={!currentEligibility?'Check your eligibility first':!profile?.salarySlip?'Upload your salary slip first':undefined} data-testid="button-apply-loan">{apply.isPending?'Submitting…':'Confirm application'} <ArrowRight size={14}/></button></div>
      {!profile?.salarySlip&&<div className="helper" style={{textAlign:'right'}}>Eligibility and a salary slip are needed before you can apply.</div>}
    </section>
  </>;
}

function BorrowerLoans() {
  const loans=useListBorrowerLoans(),[selected,setSelected]=useState<Loan|null>(null);
  return <><PageHeading eyebrow="Your account" title="Your applications." subtitle="A clear view of every step, from application to repayment." action={<Link className="primary-btn" href="/borrower"><HandCoins size={15}/> Start an application</Link>}/>
    <section className="card"><div className="card-head"><div><h2 className="section-title">Loan applications</h2><p className="section-caption">{loans.data?.total??0} applications on your account</p></div><ClipboardList size={18} color="#6b8c7f"/></div>
      {loans.isLoading?<LoadingRows/>:loans.error?<QueryError error={loans.error} retry={()=>loans.refetch()}/>:<LoansTable items={loans.data?.items||[]} onSelect={setSelected}/>}
    </section>
    {selected&&<LoansDialog loan={selected} onClose={()=>setSelected(null)}/>}
  </>;
}

function OperationsOverview({role}:{role:User['role']}) {
  const stats=useGetDashboardStats();
  const router=useRouter();
  if(stats.isLoading)return <><PageHeading eyebrow="Operations" title="Good work starts with visibility." subtitle="Your CreditSea portfolio at a glance."/><div className="grid stats-grid">{[1,2,3,4].map(x=><div className="card stat-card" key={x}><div className="skeleton" style={{height:10,width:'55%'}}/><div className="skeleton" style={{height:28,width:'42%',marginTop:16}}/></div>)}</div></>;
  if(stats.error)return <><PageHeading eyebrow="Operations" title="Good work starts with visibility." subtitle="Your CreditSea portfolio at a glance."/><QueryError error={stats.error} retry={()=>stats.refetch()}/></>;
  const d=stats.data!;
  return <><PageHeading eyebrow="Operations workspace" title="Good work starts with visibility." subtitle="Today’s portfolio, as it stands."/>
    <div className="grid stats-grid"><StatsCard label="Borrowers" value={d.borrowers.toLocaleString('en-IN')} detail="Registered accounts" icon={Users}/><StatsCard label="Unapplied leads" value={d.unappliedLeads.toLocaleString('en-IN')} detail="Ready for follow-up" icon={Phone}/><StatsCard label="Awaiting sanction" value={d.applied.toLocaleString('en-IN')} detail="Applications to review" icon={ClipboardList}/><StatsCard label="Outstanding" value={fmtINR(d.totalOutstandingPaise)} detail="Across active loans" icon={Wallet}/></div>
    <div className="grid split-grid"><section className="card"><div className="card-head"><div><h2 className="section-title">Work queues</h2><p className="section-caption">Pick up where the team needs you.</p></div><Activity size={18} color="#557f72"/></div>
      <div className="card-pad" style={{paddingTop:8}}>{[
        {name:'Sales follow-up',desc:'Registered borrowers yet to apply',value:d.unappliedLeads,href:'/operations/sales',icon:Users},
        {name:'Sanction review',desc:'Applications awaiting a decision',value:d.applied,href:'/operations/sanction',icon:BadgeCheck},
        {name:'Ready to disburse',desc:'Sanctioned loans awaiting release',value:d.sanctioned,href:'/operations/disbursement',icon:Banknote},
        {name:'Collection desk',desc:'Active balances and recorded payments',value:d.disbursed,href:'/operations/collection',icon:Wallet},
      ].filter(item=>role==='ADMIN'||item.href==='/operations/'+role.toLowerCase()).map(({name,desc,value,href,icon:Icon})=><Link className="list-row" href={href} key={href}><div style={{display:'flex',alignItems:'center',gap:12}}><div className="empty-icon" style={{width:35,height:35,margin:0,borderRadius:11}}><Icon size={16}/></div><div className="list-main"><div className="list-primary">{name}</div><div className="list-secondary">{desc}</div></div></div><div style={{display:'flex',alignItems:'center',gap:10}}><strong>{value}</strong><ChevronRight size={15} color="#8b958d"/></div></Link>)}</div>
    </section><section className="loan-hero" style={{minHeight:230,display:'flex',flexDirection:'column',justifyContent:'space-between'}}><div><div className="eyebrow">Portfolio health</div><div style={{fontFamily:'Manrope',fontSize:24,fontWeight:700,letterSpacing:'-.05em',marginTop:16}}>A clear picture.<br/>Better decisions.</div><p style={{fontSize:12,color:'#b9cec5',lineHeight:1.6,maxWidth:245,marginTop:11}}>Every queue is connected. Move a loan forward and the wider picture stays current.</p></div><button className="secondary-btn" style={{alignSelf:'flex-start'}} onClick={()=>stats.refetch()} data-testid="button-refresh-stats">Refresh overview <Activity size={14}/></button></section></div>
  </>;
}

function LeadsPage() {
 const [search,setSearch]=useState(''),[page,setPage]=useState(1),[selected,setSelected]=useState<{id:string;name:string;email:string;registeredAt:string;status:string}|null>(null);
 const params=useMemo(()=>({page,pageSize:10,search:search.trim()||undefined}),[page,search]);
 const q=useListSalesLeads(params);
 return <><PageHeading eyebrow="Sales workspace" title="A conversation can start here." subtitle="Registered borrowers who haven’t started a loan application yet."/>
  <section className="card"><div className="card-head"><div><h2 className="section-title">Unapplied leads</h2><p className="section-caption">{q.data?.total??0} registered borrowers</p></div><div className="filter-row"><div className="search-wrap"><Search className="search-icon"/><input className="input" type="search" placeholder="Search name or email" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} aria-label="Search leads" data-testid="input-search-leads"/></div></div></div>
  {q.isLoading?<LoadingRows/>:q.error?<QueryError error={q.error} retry={()=>q.refetch()}/>:<><LeadTable items={q.data?.items||[]} onSelect={setSelected}/><Pagination page={page} pageSize={q.data?.pageSize||10} total={q.data?.total||0} onChange={setPage}/></>}</section>
  {selected&&<Dialog title={selected.name} onClose={()=>setSelected(null)}><div className="section-caption">Registered borrower</div><div className="list-row"><span>Email</span><strong>{selected.email}</strong></div><div className="list-row"><span>Registered</span><strong>{fmtDate(selected.registeredAt)}</strong></div><div className="list-row"><span>Current status</span><Status value={selected.status}/></div><div className="notice info" style={{marginTop:16}}>This borrower has not applied for a loan. Reach out through your approved channels.</div></Dialog>}
 </>;
}
function Pagination({page,pageSize,total,onChange}:{page:number;pageSize:number;total:number;onChange:(n:number)=>void}) { const pages=Math.max(1,Math.ceil(total/pageSize));return <div className="pagination"><span>Showing {total?((page-1)*pageSize+1):0}–{Math.min(page*pageSize,total)} of {total}</span><div className="pagination-controls"><button onClick={()=>onChange(page-1)} disabled={page<=1} aria-label="Previous page">Previous</button><button onClick={()=>onChange(page+1)} disabled={page>=pages} aria-label="Next page">Next</button></div></div>; }

function SanctionPage() {
 const qc=useQueryClient(),[search,setSearch]=useState(''),[page,setPage]=useState(1),[selected,setSelected]=useState<Loan|null>(null),[note,setNote]=useState(''),[reason,setReason]=useState('');
 const params=useMemo(()=>({page,pageSize:10,search:search.trim()||undefined}),[page,search]),q=useListSanctionLoans(params),approve=useApproveLoan(),reject=useRejectLoan();
 const refresh=()=>{qc.invalidateQueries({queryKey:getListSanctionLoansQueryKey()});qc.invalidateQueries({queryKey:getGetDashboardStatsQueryKey()});};
 const approveOne=()=>{if(!selected)return;approve.mutate({id:selected.id,data:{note:note||undefined}},{onSuccess:()=>{refresh();setSelected(null);setNote('');}});};
 const rejectOne=()=>{if(!selected||reason.trim().length<5)return;reject.mutate({id:selected.id,data:{reason:reason.trim()}},{onSuccess:()=>{refresh();setSelected(null);setReason('');}});};
 return <><PageHeading eyebrow="Credit review" title="Every decision, considered." subtitle="Review applications against borrower details and make a clear sanction decision."/>
  <section className="card"><div className="card-head"><div><h2 className="section-title">Awaiting sanction</h2><p className="section-caption">{q.data?.total??0} applications in the review queue</p></div><div className="search-wrap"><Search className="search-icon"/><input className="input" type="search" placeholder="Search applications" aria-label="Search sanction queue" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} data-testid="input-search-sanction"/></div></div>
  {q.isLoading?<LoadingRows/>:q.error?<QueryError error={q.error} retry={()=>q.refetch()}/>:<><LoansTable items={q.data?.items||[]} onSelect={setSelected} actions={l=><button className="text-btn" onClick={()=>setSelected(l)} data-testid={`button-review-${l.id}`}>Review <ChevronRight size={14}/></button>}/><Pagination page={page} pageSize={q.data?.pageSize||10} total={q.data?.total||0} onChange={setPage}/></>}</section>
  {selected&&<Dialog title={`Review ${selected.reference}`} onClose={()=>{setSelected(null);setNote('');setReason('');}}><div className="notice info" style={{marginBottom:16}}>Verify the profile, income proof and requested terms before recording a decision.</div>{selected.salarySlipAvailable&&<SanctionSlipDownload id={selected.id}/>}<div className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:12}}><div><div className="helper">Borrower</div><strong>{selected.borrowerName}</strong></div><div><div className="helper">PAN on file</div><strong>{selected.panMasked||'Not provided'}</strong></div><div><div className="helper">Monthly salary</div><strong>{selected.monthlySalaryRupees?fmtRupees(selected.monthlySalaryRupees):'Not provided'}</strong></div><div><div className="helper">Income proof</div><strong>{selected.salarySlipAvailable?'Available':'Not available'}</strong></div><div><div className="helper">Requested principal</div><strong>{fmtINR(selected.principalPaise)}</strong></div><div><div className="helper">Tenure</div><strong>{selected.tenureDays} days</strong></div></div>
    <div className="field" style={{marginTop:18}}><label htmlFor="sanction-note">Approval note (optional)</label><textarea id="sanction-note" className="textarea" rows={2} maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="Add a note for the loan record" data-testid="input-approval-note"/></div>
    {(approve.error||reject.error)&&<div className="notice error" style={{marginTop:12}} role="alert">{getError(approve.error||reject.error)}</div>}
    <div className="field" style={{marginTop:15}}><label htmlFor="reject-reason">Rejection reason (required to reject)</label><textarea id="reject-reason" className="textarea" rows={2} minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Provide a clear reason for the borrower" data-testid="input-rejection-reason"/></div>
    <div className="form-actions"><button className="danger-btn" disabled={reject.isPending||reason.trim().length<5} onClick={rejectOne} data-testid="button-reject-loan">{reject.isPending?'Rejecting…':'Reject'}</button><button className="primary-btn" disabled={approve.isPending} onClick={approveOne} data-testid="button-approve-loan">{approve.isPending?'Approving…':'Approve'} <Check size={14}/></button></div>
  </Dialog>}
 </>;
}
function SanctionSlipDownload({id}:{id:string}) {
  const query=useDownloadSanctionSalarySlip(id,{query:{enabled:false,queryKey:getDownloadSanctionSalarySlipQueryKey(id)}});
  const download=async()=>{const response=await query.refetch();if(response.data){const url=URL.createObjectURL(response.data);const link=document.createElement('a');link.href=url;link.download=`salary-slip-${id}`;link.click();URL.revokeObjectURL(url);}};
  return <div style={{marginBottom:16}}><button className="secondary-btn" onClick={download} disabled={query.isFetching} data-testid="button-download-sanction-slip"><Download size={14}/>{query.isFetching?'Preparing private document…':'View private salary slip'}</button>{query.error&&<div className="notice error" role="alert" style={{marginTop:8}}>{getError(query.error)}</div>}</div>;
}
function DisbursementPage() {
 const qc=useQueryClient(),[search,setSearch]=useState(''),[page,setPage]=useState(1),[selected,setSelected]=useState<Loan|null>(null),qparams=useMemo(()=>({page,pageSize:10,search:search.trim()||undefined}),[page,search]),q=useListDisbursementLoans(qparams),disburse=useDisburseLoan();
 const confirm=()=>selected&&disburse.mutate({id:selected.id,data:{confirmed:true}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListDisbursementLoansQueryKey()});qc.invalidateQueries({queryKey:getGetDashboardStatsQueryKey()});setSelected(null);}});
 return <><PageHeading eyebrow="Treasury operations" title="A final check before release." subtitle="Confirm the details before disbursing a sanctioned loan."/>
 <section className="card"><div className="card-head"><div><h2 className="section-title">Ready for disbursement</h2><p className="section-caption">{q.data?.total??0} approved loans ready for release</p></div><div className="search-wrap"><Search className="search-icon"/><input className="input" type="search" aria-label="Search disbursement queue" placeholder="Search applications" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} data-testid="input-search-disbursement"/></div></div>{q.isLoading?<LoadingRows/>:q.error?<QueryError error={q.error} retry={()=>q.refetch()}/>:<><LoansTable items={q.data?.items||[]} onSelect={setSelected} actions={l=><button className="text-btn" onClick={()=>setSelected(l)} data-testid={`button-confirm-${l.id}`}>Confirm release <ChevronRight size={14}/></button>}/><Pagination page={page} pageSize={q.data?.pageSize||10} total={q.data?.total||0} onChange={setPage}/></>}</section>
 {selected&&<Dialog title={`Disburse ${selected.reference}`} onClose={()=>setSelected(null)}><div className="notice info" style={{marginBottom:18}}>Please confirm that the bank transfer for this sanctioned loan has been completed.</div><div className="loan-hero"><div className="eyebrow">Release amount</div><div className="loan-hero-value">{fmtINR(selected.principalPaise)}</div><div className="loan-hero-sub">{selected.borrowerName} · {selected.tenureDays} day term</div></div><div className="list-row"><span>Sanctioned on</span><strong>{fmtDate(selected.sanctionedAt)}</strong></div><div className="list-row"><span>Sanctioned by</span><strong>{selected.sanctionedBy||'—'}</strong></div>{disburse.error&&<div className="notice error" style={{marginTop:12}}>{getError(disburse.error)}</div>}<div className="form-actions"><button className="secondary-btn" onClick={()=>setSelected(null)}>Cancel</button><button className="primary-btn" onClick={confirm} disabled={disburse.isPending} data-testid="button-confirm-disbursement">{disburse.isPending?'Confirming…':'Confirm transfer'} <Check size={14}/></button></div></Dialog>}
 </>;
}

function CollectionDetail({loan,onClose,onLoanUpdated}:{loan:Loan;onClose:()=>void;onLoanUpdated:(loan:Loan)=>void}) {
 const qc=useQueryClient(),[utr,setUtr]=useState(''),[amount,setAmount]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10));
 const payments=useListLoanPayments(loan.id,{query:{queryKey:getListLoanPaymentsQueryKey(loan.id)}}),record=useRecordLoanPayment();
 const submit=(e:FormEvent)=>{e.preventDefault();const body:PaymentInput={utr:utr.trim(),amountPaise:Math.round(Number(amount)*100),paymentDate:date};record.mutate({id:loan.id,data:body},{onSuccess:result=>{onLoanUpdated(result.loan);qc.invalidateQueries({queryKey:getListLoanPaymentsQueryKey(loan.id)});qc.invalidateQueries({queryKey:getListCollectionLoansQueryKey()});qc.invalidateQueries({queryKey:getGetDashboardStatsQueryKey()});setUtr('');setAmount('');}});};
 return <Dialog title={loan.reference} onClose={onClose}><div className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:14}}><div><div className="helper">Borrower</div><strong>{loan.borrowerName}</strong></div><div><div className="helper">Loan status</div><Status value={loan.status}/></div><div><div className="helper">Total repayment</div><strong>{fmtINR(loan.totalRepaymentPaise)}</strong></div><div><div className="helper">Paid to date</div><strong>{fmtINR(loan.totalPaidPaise)}</strong></div><div><div className="helper">Outstanding balance</div><strong style={{color:'#1d655b'}}>{fmtINR(loan.outstandingBalancePaise)}</strong></div></div>
 <div className="separator"/><h3 className="section-title">Payment history</h3>
 {payments.isLoading?<LoadingRows count={2}/>:payments.error?<QueryError error={payments.error} retry={()=>payments.refetch()}/>:!payments.data?.items.length?<p className="section-caption">No payments have been recorded yet.</p>:<div style={{maxHeight:160,overflow:'auto',marginTop:8}}>{payments.data.items.map(p=><div key={p.id} className="list-row" data-testid={`payment-${p.id}`}><div><div className="list-primary">{fmtDate(p.paymentDate)} · {p.utr}</div><div className="list-secondary">Recorded by {p.recordedBy}</div></div><strong>{fmtINR(p.amountPaise)}</strong></div>)}</div>}
 <div className="separator"/><h3 className="section-title">Record a payment</h3><p className="section-caption">Entries update this loan’s recorded balance.</p>
 <form onSubmit={submit} className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:12,marginTop:14}}>
  <div className="field"><label htmlFor="payment-utr">Bank reference / UTR</label><input id="payment-utr" className="input" required minLength={6} maxLength={50} value={utr} onChange={e=>setUtr(e.target.value)} placeholder="Transaction reference" data-testid="input-payment-utr"/></div>
  <div className="field"><label htmlFor="payment-amount">Amount (₹)</label><input id="payment-amount" className="input" required type="number" min=".01" step=".01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" data-testid="input-payment-amount"/></div>
  <div className="field"><label htmlFor="payment-date">Payment date</label><input id="payment-date" className="input" type="date" required value={date} onChange={e=>setDate(e.target.value)} data-testid="input-payment-date"/></div>
  <div className="field" style={{alignSelf:'end'}}><button className="primary-btn" disabled={record.isPending||!utr.trim()||Number(amount)<=0} data-testid="button-record-payment">{record.isPending?'Recording…':'Record payment'} <ArrowRight size={14}/></button></div>
 </form>
 {record.error&&<div className="notice error" style={{marginTop:12}} role="alert">{getError(record.error)}</div>}
 {record.isSuccess&&<div className="notice success" style={{marginTop:12}} role="status" data-testid="status-payment-recorded">Payment recorded successfully.</div>}
 </Dialog>;
}
function CollectionPage() {
 const [search,setSearch]=useState(''),[page,setPage]=useState(1),[selected,setSelected]=useState<Loan|null>(null),params=useMemo(()=>({page,pageSize:10,search:search.trim()||undefined}),[page,search]),q=useListCollectionLoans(params);
 return <><PageHeading eyebrow="Servicing workspace" title="Keep every balance in view." subtitle="Review active loan balances, payment history and new receipts."/>
 <div className="grid stats-grid" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}><div className="card stat-card"><div className="stat-label">Collection records</div><div className="stat-value">{q.data?.total??'—'}</div><div className="stat-detail">Active loans on the collection desk</div></div><div className="card stat-card"><div className="stat-label">Outstanding in view</div><div className="stat-value">{q.data?fmtINR(q.data.items.reduce((sum,l)=>sum+l.outstandingBalancePaise,0)):'—'}</div><div className="stat-detail">Current page · confirmed balances</div></div></div>
 <section className="card"><div className="card-head"><div><h2 className="section-title">Active balances</h2><p className="section-caption">Select a loan to see payments or record a receipt.</p></div><div className="search-wrap"><Search className="search-icon"/><input className="input" type="search" aria-label="Search collection loans" placeholder="Search loans" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} data-testid="input-search-collection"/></div></div>{q.isLoading?<LoadingRows/>:q.error?<QueryError error={q.error} retry={()=>q.refetch()}/>:q.data?.items.length?<><div className="table-wrap"><table><thead><tr><th>Borrower</th><th>Reference</th><th>Repayment</th><th>Paid</th><th>Outstanding</th><th>Status</th><th></th></tr></thead><tbody>{q.data.items.map(l=><tr key={l.id} data-testid={`row-collection-${l.id}`}><td><div style={{fontWeight:700}}>{l.borrowerName}</div><div className="helper">{l.borrowerEmail}</div></td><td className="mono">{l.reference}</td><td>{fmtINR(l.totalRepaymentPaise)}</td><td>{fmtINR(l.totalPaidPaise)}</td><td style={{fontWeight:700,color:'#1d655b'}}>{fmtINR(l.outstandingBalancePaise)}</td><td><Status value={l.status}/></td><td><button className="text-btn" onClick={()=>setSelected(l)} data-testid={`button-manage-collection-${l.id}`}>Manage <ChevronRight size={14}/></button></td></tr>)}</tbody></table></div><Pagination page={page} pageSize={q.data.pageSize||10} total={q.data.total} onChange={setPage}/></>:<Empty title="No active collection records" copy="Active disbursed loans will appear here with their balances and payment history."/>}</section>
 {selected&&<CollectionDetail loan={selected} onClose={()=>setSelected(null)} onLoanUpdated={setSelected}/>}
 </>;
}

function EmployeesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<EmployeeRole>('SALES');
  const params = useMemo(() => ({ page, pageSize: 10, search: search.trim() || undefined }), [page, search]);
  const list = useListEmployees(params);
  const create = useCreateEmployee();
  const updateStatus = useUpdateEmployeeStatus();
  const resetForm = () => { setName(''); setEmail(''); setPassword(''); setRole('SALES'); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: EmployeeCreateInput = { name: name.trim(), email: email.trim(), password, role };
    create.mutate({ data: body }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
        resetForm();
        setOpen(false);
      },
    });
  };
  const toggleStatus = (id: string, status: 'ACTIVE' | 'DISABLED') => {
    updateStatus.mutate(
      { id, data: { status: status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' } },
      { onSuccess: () => qc.invalidateQueries({ queryKey: getListEmployeesQueryKey() }) },
    );
  };
  return <>
    <PageHeading eyebrow="Admin controls" title="Manage internal employees." subtitle="Create Sales, Sanction, Disbursement, and Collection accounts. Borrowers still register through public signup." />
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="section-title">Employee directory</h2>
          <p className="section-caption">{list.data?.total ?? 0} internal accounts</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="search-wrap"><Search className="search-icon" /><input className="input" type="search" aria-label="Search employees" placeholder="Search by name or email" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} data-testid="input-search-employees" /></div>
          <button className="primary-btn" onClick={() => setOpen(true)} data-testid="button-open-create-employee"><UserPlus size={14} /> Add employee</button>
        </div>
      </div>
      {list.isLoading ? <LoadingRows /> : list.error ? <QueryError error={list.error} retry={() => list.refetch()} /> : list.data?.items.length ? <>
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>{list.data.items.map(employee => <tr key={employee.id} data-testid={`row-employee-${employee.id}`}>
            <td style={{ fontWeight: 700 }}>{employee.name}</td>
            <td>{employee.email}</td>
            <td><Status value={employee.role} /></td>
            <td><Status value={employee.status} /></td>
            <td>{employee.role === 'ADMIN' ? <span className="helper">Protected</span> : <button className="text-btn" disabled={updateStatus.isPending} onClick={() => toggleStatus(employee.id, employee.status)} data-testid={`button-toggle-employee-${employee.id}`}>{employee.status === 'ACTIVE' ? 'Disable' : 'Activate'}</button>}</td>
          </tr>)}</tbody>
        </table></div>
        <Pagination page={page} pageSize={list.data.pageSize || 10} total={list.data.total} onChange={setPage} />
      </> : <Empty title="No employees yet" copy="Create the first Sales, Sanction, Disbursement, or Collection account." />}
    </section>
    {open && <Dialog title="Create employee" onClose={() => { setOpen(false); resetForm(); }}>
      <form onSubmit={submit} className="grid" style={{ gap: 12 }}>
        <div className="field"><label htmlFor="employee-name">Full name</label><input id="employee-name" className="input" required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} data-testid="input-employee-name" /></div>
        <div className="field"><label htmlFor="employee-email">Work email</label><input id="employee-email" className="input" type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} data-testid="input-employee-email" /></div>
        <div className="field"><label htmlFor="employee-role">Role</label><select id="employee-role" className="input" value={role} onChange={e => setRole(e.target.value as EmployeeRole)} data-testid="select-employee-role">{EMPLOYEE_ROLE_OPTIONS.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}</select></div>
        <div className="field"><label htmlFor="employee-password">Temporary password</label><PasswordInput id="employee-password" required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} data-testid="input-employee-password" /><small className="helper">At least 12 characters. Share it securely with the employee.</small></div>
        {create.error && <div className="notice error" role="alert">{getError(create.error)}</div>}
        <div className="form-actions"><button type="button" className="secondary-btn" onClick={() => { setOpen(false); resetForm(); }}>Cancel</button><button type="submit" className="primary-btn" disabled={create.isPending} data-testid="button-create-employee">{create.isPending ? 'Creating…' : 'Create employee'} <ArrowRight size={14} /></button></div>
      </form>
    </Dialog>}
  </>;
}

export default function Portal({page}:{page:Page}) {
 const userQuery=useGetCurrentUser({query:{queryKey:getGetCurrentUserQueryKey(),retry:false}});
 if(page==='home')return <Entry user={userQuery.data}/>;
 if(page==='login')return <AuthPage signup={false}/>;
 if(page==='signup')return <AuthPage signup/>;
 if(userQuery.isLoading)return <div style={{minHeight:'100dvh',display:'grid',placeItems:'center'}}><div className="skeleton" style={{width:220,height:18}}/></div>;
 if(userQuery.error)return <div className="auth-page"><aside className="auth-aside"><Link className="brand-row" href="/"><span className="brand-mark">C</span><span className="brand-name">creditsea</span></Link><div className="aside-copy"><h2>One account.<br/>A clearer view.</h2><p>Sign in securely to continue to your CreditSea workspace.</p></div></aside><main className="auth-main"><div className="auth-box"><div className="eyebrow">Secure sign in</div><h1>Your session has ended.</h1><p>Sign in to access your account and continue where you left off.</p><Link className="primary-btn" href="/login" data-testid="link-sign-in">Sign in <ArrowRight size={15}/></Link></div></main></div>;
 const user=userQuery.data;
 if(!user)return <div style={{minHeight:'100dvh',display:'grid',placeItems:'center'}}><div className="skeleton" style={{width:220,height:18}}/></div>;
 const allowed = PAGE_ROLES[page]?.includes(user.role) ?? false;
 if(!allowed)return <AppShell page={page} user={user}><div className="card card-pad" style={{maxWidth:600,margin:'45px auto'}}><div className="empty-icon"><ShieldCheck size={20}/></div><h1 style={{fontSize:25}}>This workspace is for a different role.</h1><p className="page-subtitle">You’re signed in as {titleCase(user.role)}. Choose your workspace to continue.</p><div style={{display:'flex',gap:10,marginTop:20}}><Link className="primary-btn" href={user.role==='BORROWER'?'/borrower':'/operations'}>Go to my workspace <ArrowRight size={14}/></Link></div></div></AppShell>;
 let content:React.ReactNode;
 switch(page){
  case 'borrower': content=<BorrowerApplication/>;break;
  case 'borrower-loans':content=<BorrowerLoans/>;break;
  case 'operations':content=<OperationsOverview role={user.role}/>;break;
  case 'sales':content=<LeadsPage/>;break;
  case 'sanction':content=<SanctionPage/>;break;
  case 'disbursement':content=<DisbursementPage/>;break;
  case 'collection':content=<CollectionPage/>;break;
  case 'employees':content=<EmployeesPage/>;break;
  default:content=null;
 }
 return <AppShell page={page} user={user}>{content}</AppShell>;
}

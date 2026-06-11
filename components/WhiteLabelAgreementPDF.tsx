import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 11,
    fontFamily: 'Helvetica',
    lineHeight: 1.5,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 6,
    textAlign: 'center',
    color: '#111827',
  },
  subtitle: {
    fontSize: 10,
    textAlign: 'center',
    color: '#6b7280',
    marginBottom: 24,
  },
  section: {
    marginBottom: 14,
  },
  label: {
    fontWeight: 'bold',
    fontSize: 11,
    color: '#374151',
    marginBottom: 2,
  },
  value: {
    fontSize: 11,
    color: '#111827',
    marginBottom: 8,
  },
  body: {
    fontSize: 10,
    marginBottom: 10,
    textAlign: 'justify',
  },
  legalStub: {
    fontSize: 9,
    lineHeight: 1.4,
    color: '#374151',
    backgroundColor: '#f9fafb',
    padding: 12,
    borderRadius: 4, // note: pdf renderer supports limited
    marginTop: 10,
    marginBottom: 20,
  },
  acceptance: {
    marginTop: 20,
    padding: 10,
    borderWidth: 1,
    borderColor: '#111827',
    backgroundColor: '#f3f4f6',
  },
  sig: {
    marginTop: 30,
    fontSize: 10,
  },
  footer: {
    marginTop: 40,
    fontSize: 8,
    color: '#6b7280',
    textAlign: 'center',
  },
});

interface Props {
  companyName: string;
  contactName: string;
  email: string;
  date: Date;
  address?: string;
  city?: string;
  state?: string;
  website?: string;
}

export function WhiteLabelAgreementPDF({
  companyName,
  contactName,
  email,
  date,
  address,
  city,
  state,
  website,
}: Props) {
  const formattedDate = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const addressLine = [address, city, state].filter(Boolean).join(', ');

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>WHITE LABEL COMPANY AGREEMENT</Text>
        <Text style={styles.subtitle}>Platform Access and Branding License</Text>

        <View style={styles.section}>
          <Text style={styles.label}>Effective Date</Text>
          <Text style={styles.value}>{formattedDate}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Company Name</Text>
          <Text style={styles.value}>{companyName || 'N/A'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Primary Contact / Authorized Signer</Text>
          <Text style={styles.value}>{contactName || 'N/A'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Contact Email</Text>
          <Text style={styles.value}>{email || 'N/A'}</Text>
        </View>

        {addressLine && (
          <View style={styles.section}>
            <Text style={styles.label}>Business Address</Text>
            <Text style={styles.value}>{addressLine}</Text>
          </View>
        )}

        {website && (
          <View style={styles.section}>
            <Text style={styles.label}>Website</Text>
            <Text style={styles.value}>{website}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.body}>
            This White Label Company Agreement (the "Agreement") is made between the above-named Company ("Company") and the platform provider ("Provider").
          </Text>
        </View>

        <Text style={styles.legalStub}>
          1. WHITE LABEL RIGHTS. Provider grants Company a limited, revocable, non-exclusive, non-transferable license to use the lending platform services under Company's own branding and domain, subject to approval and ongoing compliance.
          {'\n\n'}2. COMPANY OBLIGATIONS. Company shall maintain accurate corporate records, provide the required documents (Operating Agreement, EIN confirmation, Articles of Organization, Certificate of Good Standing) as part of onboarding, and ensure all information submitted remains current and truthful.
          {'\n\n'}3. COMPLIANCE &amp; DATA. Company agrees to all platform terms of service, privacy policy, fair lending laws, and data security requirements. Provider may access, store, and process application and loan data as necessary to provide the white-labeled services.
          {'\n\n'}4. TERM &amp; TERMINATION. This Agreement is effective upon acceptance and submission of the organization application and continues until terminated by either party or upon revocation of approval.
          {'\n\n'}5. ATTESTATION &amp; ACCEPTANCE. By generating this PDF, checking the acceptance checkbox, and submitting the organization application, the undersigned contact (on behalf of Company) acknowledges they have read, understand, and agree to this Agreement and all referenced policies. The signer warrants authority to bind Company.
          {'\n\n'}[This is a legal stub. Full terms, conditions, fees, liability limitations, governing law, and additional clauses are set forth in the master platform agreement and terms of service available upon request or in the provider portal. Acceptance here constitutes binding agreement to all such terms.]
        </Text>

        <View style={styles.acceptance}>
          <Text style={{ fontWeight: 'bold', marginBottom: 6 }}>ACCEPTANCE</Text>
          <Text>Agreement accepted on: {formattedDate}</Text>
          <Text>By: {contactName} ({email})</Text>
          <Text>For Company: {companyName}</Text>
          <Text style={{ marginTop: 6, fontSize: 9 }}>✓ Checkbox confirmed in application form prior to submission</Text>
        </View>

        <View style={styles.sig}>
          <Text>Authorized Signature (electronic acceptance): _______________________________</Text>
          <Text style={{ marginTop: 8 }}>Date: {formattedDate}</Text>
        </View>

        <Text style={styles.footer}>
          Auto-generated PDF for organization application. Retained with application records in secure storage.
          Not a substitute for full executed master service agreement.
        </Text>
      </Page>
    </Document>
  );
}
